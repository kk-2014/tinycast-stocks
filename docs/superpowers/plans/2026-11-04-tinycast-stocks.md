# Tinycast Stocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Raycast-compatible extension for Tinycast that searches stocks by name/ticker and shows a Google Finance quote with stats, a price chart, and news.

**Architecture:** Pure parser (`parse.ts`) turns a Google Finance HTML page into a typed `Quote` by locating `AF_initDataCallback` JSON blobs *by shape* (never by CSS class or `ds:N` number). Network code (`google.ts`, `search.ts`) takes an injectable `Fetcher` so everything is unit-testable against a saved fixture. The UI (`index.tsx`) fetches details only for the highlighted row and always renders an explicit error state.

**Tech Stack:** TypeScript, React, `@raycast/api` (Tinycast ships its own Raycast runtime), vitest, tsx, Node 22 (`/opt/homebrew/bin/node`).

**Spec:** `docs/superpowers/specs/2026-11-04-tinycast-stocks-design.md`
**Fixture:** `test/fixtures/AAPL-NASDAQ-2026-11-03.html` (real Google page, AAPL:NASDAQ, captured 2026-11-03 ~13:46 ET).

## Verified blob structure (from the fixture)

All paths below were decoded from the fixture and are the basis for the parser predicates.

| Data | Shape (index → meaning) |
|---|---|
| Quote entry | `[mid, [SYM, EXCH], name, _, currency, [price, change, changePct, …], _, previousClose, …, [updatedAtEpoch] at [11], …]` |
| Trading data | `[[null,[SYM,EXCH]], _, open, _, low, high, price, _, change, _, pct, _, currency, "SYM:EXCH", name, prevClose, marketCap, volume, …]` |
| Profile | `[mid, shortName, description(>40 chars), …, [6]=employees, [12]=52wk high, [13]=52wk low, [14]=volume, [16]=P/E, [18]=avg volume, [19]=EPS, [20]=beta, [21]=shares outstanding]` — `mid` equals the quote entry's `mid` |
| Chart entry | `[[SYM,EXCH], mid, currency, [series…], …, tz, prevClose, name, intervalSeconds, 0]` — interval is `entry[entry.length-2]`; 300 = 5-minute intraday, 86400 = daily |
| Candle | `[open, close, high, low, "ISO-8601 time", volume]` |
| News item | `["https://…", title, source, faviconUrl, publishedAtEpochSeconds, …]` |

Note: the quote entry's field at index 16 (e.g. `326.21`) is **not** the headline price and is ignored in v1. The headline price is `entry[5][0]`; `price − previousClose == change` holds exactly.

## File Structure

```
tinycast-stocks/
  package.json              manifest + scripts
  tsconfig.json
  .gitignore
  extension-icon.png        copied from the old extension
  src/
    types.ts                Candle, NewsItem, Stats, Quote, ParseResult
    blobs.ts                extractBlobs(html), walk(value)
    parse.ts                parseGoogleFinance(html, symbol, exchange): ParseResult
    chart.ts                buildChartSvg(candles, opts), svgToDataUri(svg)
    format.ts               compact, money, signed, timeAgo
    http.ts                 UA, Fetcher type, defaultFetcher
    google.ts               fetchQuote(symbol, opts) with exchange probing
    search.ts               searchStocks(query, opts)
    cache.ts                KV interface, getFresh/putFresh (pure, injectable)
    kv.ts                   raycastKV (LocalStorage-backed KV)
    favorites.ts            Fav type, toggle, parseFavs (pure)
    chartImage.ts           chartMarkdown(svg, key): embeds chart per spike result
    useQuote.ts             React hook: debounced, abortable, cached quote fetch
    index.tsx               List + Detail UI
  test/
    fixtures/AAPL-NASDAQ-2026-11-03.html
    blobs.test.ts  parse.test.ts  chart.test.ts  format.test.ts
    google.test.ts search.test.ts cache.test.ts   favorites.test.ts
  scripts/live-check.ts     live drift check
  kambaldhage.md            plain-language project explainer
```

---

### Task 1: Scaffold + chart-rendering spike (needs a human look)

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `extension-icon.png`, `src/index.tsx` (temporary spike)

- [ ] **Step 1: Create `package.json`**

```json
{
  "$schema": "https://www.raycast.com/schemas/extension.json",
  "name": "tinycast-stocks",
  "title": "Stocks",
  "description": "Google Finance quotes, charts and news",
  "icon": "extension-icon.png",
  "author": "kambaldhage",
  "platforms": ["macOS"],
  "categories": ["Finance"],
  "license": "MIT",
  "commands": [
    {
      "name": "index",
      "title": "Search Stocks",
      "description": "Search stocks and view quote, chart and news",
      "mode": "view"
    }
  ],
  "dependencies": {
    "@raycast/api": "^1.104.11"
  },
  "scripts": {
    "build": "ray build",
    "dev": "ray develop",
    "test": "vitest run",
    "live-check": "tsx scripts/live-check.ts"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json` and `.gitignore`**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "lib": ["ES2022"],
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/**/*", "raycast-env.d.ts"]
}
```

`.gitignore`:
```
node_modules
dist
.DS_Store
```

- [ ] **Step 3: Install dependencies and copy the icon**

Run:
```bash
cd ~/claude/tinycast-stocks
npm install
npm install -D vitest tsx typescript @types/node@22 @types/react@19
ls "$HOME/Library/Application Support/com.tinycast.app/extensions/google-finance/assets"
cp "$HOME/Library/Application Support/com.tinycast.app/extensions/google-finance/assets/extension-icon.png" extension-icon.png 2>/dev/null || echo "NO ICON FOUND"
```
Expected: install succeeds; if the `cp` prints `NO ICON FOUND`, create one with `python3 -I -c "import zlib,struct;..."` is NOT needed — instead run `sips -z 512 512 /System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/GenericApplicationIcon.icns --out extension-icon.png` (any 512x512 PNG works).

- [ ] **Step 4: Write the spike `src/index.tsx`**

```tsx
import { Detail } from "@raycast/api";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="120" viewBox="0 0 400 120">' +
  '<rect width="400" height="120" fill="#eef"/>' +
  '<path d="M10 100 L100 60 L200 80 L300 20 L390 40" fill="none" stroke="#34a853" stroke-width="3"/>' +
  "</svg>";

export default function Command() {
  const dir = join(tmpdir(), "tinycast-stocks");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "spike.svg");
  writeFileSync(file, svg);
  const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  const md = [
    "# Chart spike",
    "A) data URI:",
    `![A](${dataUri})`,
    "B) file:// URL:",
    `![B](file://${file})`,
    "C) absolute path:",
    `![C](${file})`,
    "D) text sparkline: ▁▂▃▅▇▆▄",
  ].join("\n\n");
  return <Detail markdown={md} />;
}
```

- [ ] **Step 5: Build and import into Tinycast**

Run: `cd ~/claude/tinycast-stocks && npx ray build`
Expected: build succeeds. Then check where output went:
`ls ~/.config/raycast/extensions/` — if `tinycast-stocks` is not there, run `npx ray build -o ~/.config/raycast/extensions/tinycast-stocks`.
Open Tinycast → Extensions → import/install `Stocks`. (If `ray build` rejects the `author` field, change `author` to `kyle_samani` only for the local build, and note it in the commit message.)

- [ ] **Step 6: Human check — which of A/B/C/D rendered?**

Open the "Search Stocks" command in Tinycast. Record which of A (data URI), B (file://), C (absolute path) show the green line chart. Write the winner into `src/chartImage.ts` in Task 8 (`CHART_MODE`). If none render, use D (text sparkline) and the `chartMarkdown` function returns a sparkline instead — Task 8 covers it.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold extension and add chart-rendering spike"
```

---

### Task 2: Types and blob extraction

**Files:**
- Create: `src/types.ts`, `src/blobs.ts`
- Test: `test/blobs.test.ts`

- [ ] **Step 1: Write `src/types.ts`**

```ts
export interface Candle {
  open: number;
  close: number;
  high: number;
  low: number;
  /** ISO-8601 with offset, e.g. 2026-11-03T09:30:00-05:00 */
  time: string;
  volume: number;
}

export interface NewsItem {
  url: string;
  title: string;
  source: string;
  /** Unix epoch seconds */
  publishedAt: number;
}

export interface Stats {
  open?: number;
  high?: number;
  low?: number;
  marketCap?: number;
  volume?: number;
  avgVolume?: number;
  yearHigh?: number;
  yearLow?: number;
  peRatio?: number;
  eps?: number;
  beta?: number;
  sharesOutstanding?: number;
  employees?: number;
}

export interface Quote {
  symbol: string;
  exchange: string;
  name: string;
  currency: string;
  price: number;
  change: number;
  changePercent: number;
  previousClose: number;
  /** Unix epoch seconds of the quote, if present */
  updatedAt?: number;
  description?: string;
  stats: Stats;
  /** 5-minute candles for the current session (may be empty) */
  intraday: Candle[];
  /** Daily candles, about one month (may be empty) */
  daily: Candle[];
  news: NewsItem[];
}

export type FailureKind = "layout" | "not-found" | "blocked" | "network";

export type ParseResult =
  | { ok: true; quote: Quote }
  | { ok: false; kind: FailureKind; reason: string };
```

- [ ] **Step 2: Write the failing test `test/blobs.test.ts`**

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractBlobs, walk } from "../src/blobs";

const html = readFileSync(join(__dirname, "fixtures/AAPL-NASDAQ-2026-11-03.html"), "utf8");

describe("extractBlobs", () => {
  it("decodes every AF_initDataCallback blob in the fixture", () => {
    expect(extractBlobs(html).length).toBe(20);
  });

  it("returns an empty array for a page with no blobs", () => {
    expect(extractBlobs("<html><body>nothing</body></html>")).toEqual([]);
  });

  it("handles brackets and escaped quotes inside strings", () => {
    const page = `AF_initDataCallback({key: 'ds:0', hash: '1', data:["a]b","q\\"[",[1,2]], sideChannel: {}});`;
    expect(extractBlobs(page)).toEqual([["a]b", 'q"[', [1, 2]]]);
  });
});

describe("walk", () => {
  it("yields every nested array", () => {
    const seen = [...walk([1, [2, [3]], "x"])];
    expect(seen.length).toBe(3);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/blobs.test.ts`
Expected: FAIL — cannot find module `../src/blobs`.

- [ ] **Step 4: Write `src/blobs.ts`**

```ts
const START = /AF_initDataCallback\(\{key: 'ds:\d+', hash: '\d+', data:/g;

/** Slice the JSON array that starts at `start`, honouring strings and escapes. */
function sliceJsonArray(s: string, start: number): string | null {
  if (s[start] !== "[") return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/** Decode every AF_initDataCallback data blob in a Google Finance page. */
export function extractBlobs(html: string): unknown[] {
  const blobs: unknown[] = [];
  START.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = START.exec(html))) {
    const json = sliceJsonArray(html, m.index + m[0].length);
    if (json === null) continue;
    try {
      blobs.push(JSON.parse(json));
    } catch {
      // A malformed blob is skipped; the parser reports a layout failure if nothing usable remains.
    }
  }
  return blobs;
}

/** Depth-first walk yielding every array nested in `value`, including `value` itself. */
export function* walk(value: unknown): Generator<unknown[]> {
  if (!Array.isArray(value)) return;
  yield value;
  for (const child of value) yield* walk(child);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/blobs.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/blobs.ts test/blobs.test.ts
git commit -m "feat: extract AF_initDataCallback blobs from Google Finance pages"
```

---

### Task 3: Parser — quote entry

**Files:**
- Create: `src/parse.ts`
- Test: `test/parse.test.ts`

- [ ] **Step 1: Write the failing test `test/parse.test.ts`**

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseGoogleFinance } from "../src/parse";

const html = readFileSync(join(__dirname, "fixtures/AAPL-NASDAQ-2026-11-03.html"), "utf8");

function parsed() {
  const r = parseGoogleFinance(html, "AAPL", "NASDAQ");
  if (!r.ok) throw new Error(`expected ok, got ${r.kind}: ${r.reason}`);
  return r.quote;
}

describe("parseGoogleFinance: quote", () => {
  it("extracts identity and headline quote", () => {
    const q = parsed();
    expect(q.symbol).toBe("AAPL");
    expect(q.exchange).toBe("NASDAQ");
    expect(q.name).toBe("Apple Inc");
    expect(q.currency).toBe("USD");
    expect(q.price).toBeCloseTo(331.775, 3);
    expect(q.change).toBeCloseTo(-6.545, 3);
    expect(q.changePercent).toBeCloseTo(-1.9346, 3);
    expect(q.previousClose).toBeCloseTo(338.32, 2);
    expect(q.updatedAt).toBe(1793731545);
  });

  it("is internally consistent: price - previousClose == change", () => {
    const q = parsed();
    expect(q.price - q.previousClose).toBeCloseTo(q.change, 3);
  });
});

describe("parseGoogleFinance: failures", () => {
  it("reports a layout failure when there are no data blobs", () => {
    const r = parseGoogleFinance("<html>consent wall</html>", "AAPL", "NASDAQ");
    expect(r).toMatchObject({ ok: false, kind: "layout" });
  });

  it("reports not-found when the page is for a different symbol", () => {
    const r = parseGoogleFinance(html, "MSFT", "NASDAQ");
    expect(r).toMatchObject({ ok: false, kind: "not-found" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/parse.test.ts`
Expected: FAIL — cannot find module `../src/parse`.

- [ ] **Step 3: Write `src/parse.ts`** (quote only; later tasks extend `parseGoogleFinance`)

```ts
import { extractBlobs, walk } from "./blobs";
import type { ParseResult, Quote } from "./types";

export const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isStr = (x: unknown): x is string => typeof x === "string";

function findAll(blobs: unknown[], predicate: (a: unknown[]) => boolean): unknown[][] {
  const out: unknown[][] = [];
  for (const blob of blobs) for (const a of walk(blob)) if (predicate(a)) out.push(a);
  return out;
}

/** `[mid, [SYM, EXCH], name, _, currency, [price, change, pct, …], _, prevClose, …]` */
export function findQuoteEntry(blobs: unknown[], symbol: string, exchange: string): unknown[] | undefined {
  return findAll(
    blobs,
    (a) =>
      Array.isArray(a[1]) &&
      a[1][0] === symbol &&
      a[1][1] === exchange &&
      isStr(a[2]) &&
      isStr(a[4]) &&
      Array.isArray(a[5]) &&
      isNum(a[5][0]) &&
      isNum(a[5][1]) &&
      isNum(a[5][2]) &&
      isNum(a[7]),
  )[0];
}

export function parseGoogleFinance(html: string, symbol: string, exchange: string): ParseResult {
  const blobs = extractBlobs(html);
  if (blobs.length === 0) {
    return {
      ok: false,
      kind: "layout",
      reason: "No data found in the Google Finance page (layout changed or a consent page was served).",
    };
  }

  const entry = findQuoteEntry(blobs, symbol, exchange);
  if (!entry) {
    return { ok: false, kind: "not-found", reason: `No ${symbol}:${exchange} quote found on the page.` };
  }

  const [price, change, changePercent] = entry[5] as number[];
  const updated = Array.isArray(entry[11]) && isNum(entry[11][0]) ? entry[11][0] : undefined;

  const quote: Quote = {
    symbol,
    exchange,
    name: entry[2] as string,
    currency: entry[4] as string,
    price,
    change,
    changePercent,
    previousClose: entry[7] as number,
    updatedAt: updated,
    stats: {},
    intraday: [],
    daily: [],
    news: [],
  };
  return { ok: true, quote };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/parse.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/parse.ts test/parse.test.ts
git commit -m "feat: parse headline quote from Google Finance blobs"
```

---

### Task 4: Parser — stats and description

**Files:**
- Modify: `src/parse.ts`
- Test: `test/parse.test.ts`

- [ ] **Step 1: Append failing tests to `test/parse.test.ts`**

```ts
describe("parseGoogleFinance: stats", () => {
  it("extracts trading data and profile stats", () => {
    const s = parsed().stats;
    expect(s.open).toBeCloseTo(325.58, 2);
    expect(s.high).toBeCloseTo(334.5, 2);
    expect(s.low).toBeCloseTo(325.33, 2);
    expect(s.marketCap).toBeGreaterThan(4.8e12);
    expect(s.volume).toBe(36283672);
    expect(s.yearHigh).toBeCloseTo(351.73, 2);
    expect(s.yearLow).toBeCloseTo(243.42, 2);
    expect(s.peRatio).toBeCloseTo(36.95, 1);
    expect(s.avgVolume).toBe(39698332);
    expect(s.eps).toBeCloseTo(8.98, 1);
    expect(s.beta).toBeCloseTo(1.07, 1);
    expect(s.sharesOutstanding).toBe(14594180000);
    expect(s.employees).toBe(166000);
  });

  it("extracts the company description", () => {
    expect(parsed().description).toMatch(/^Apple Inc\./);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/parse.test.ts`
Expected: FAIL — `s.open` is `undefined`.

- [ ] **Step 3: Add stats extraction to `src/parse.ts`**

Add above `parseGoogleFinance`:

```ts
const optNum = (x: unknown): number | undefined => (isNum(x) ? x : undefined);

/** `[[null,[SYM,EXCH]], _, open, _, low, high, price, _, change, _, pct, _, cur, "SYM:EXCH", name, prevClose, marketCap, volume, …]` */
function findTrading(blobs: unknown[], symbol: string, exchange: string): unknown[] | undefined {
  return findAll(
    blobs,
    (a) =>
      Array.isArray(a[0]) &&
      a[0][0] === null &&
      Array.isArray(a[0][1]) &&
      a[0][1][0] === symbol &&
      a[0][1][1] === exchange &&
      isNum(a[2]) &&
      isNum(a[4]) &&
      isNum(a[5]) &&
      isNum(a[16]) &&
      isNum(a[17]),
  )[0];
}

/** `[mid, shortName, description, …, [12]=52wk hi, [13]=52wk lo, [14]=volume, [16]=P/E, …]` */
function findProfile(blobs: unknown[], mid: unknown): unknown[] | undefined {
  return findAll(
    blobs,
    (a) =>
      a[0] === mid &&
      isStr(a[1]) &&
      isStr(a[2]) &&
      a[2].length > 40 &&
      isNum(a[12]) &&
      isNum(a[13]) &&
      isNum(a[14]),
  )[0];
}
```

In `parseGoogleFinance`, replace `stats: {},` by computed stats. Insert before `const quote: Quote = {`:

```ts
  const trading = findTrading(blobs, symbol, exchange);
  const profile = findProfile(blobs, entry[0]);
  const stats: Stats = {
    open: optNum(trading?.[2]),
    low: optNum(trading?.[4]),
    high: optNum(trading?.[5]),
    marketCap: optNum(trading?.[16]),
    volume: optNum(trading?.[17]) ?? optNum(profile?.[14]),
    employees: optNum(profile?.[6]),
    yearHigh: optNum(profile?.[12]),
    yearLow: optNum(profile?.[13]),
    peRatio: optNum(profile?.[16]),
    avgVolume: optNum(profile?.[18]),
    eps: optNum(profile?.[19]),
    beta: optNum(profile?.[20]),
    sharesOutstanding: optNum(profile?.[21]),
  };
```

Update the object: `stats,` and add `description: isStr(profile?.[2]) ? (profile[2] as string) : undefined,`. Change the import to `import type { ParseResult, Quote, Stats } from "./types";`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/parse.test.ts`
Expected: PASS (6 tests). If a numeric assertion fails, print the actual value and compare with the table at the top of this plan before changing the assertion — the index map was decoded from the fixture.

- [ ] **Step 5: Commit**

```bash
git add src/parse.ts test/parse.test.ts
git commit -m "feat: parse trading stats and company profile"
```

---

### Task 5: Parser — candles

**Files:**
- Modify: `src/parse.ts`
- Test: `test/parse.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe("parseGoogleFinance: candles", () => {
  it("extracts 5-minute intraday candles", () => {
    const q = parsed();
    expect(q.intraday.length).toBe(52);
    expect(q.intraday[0]).toEqual({
      open: 325.58,
      close: 326.04,
      high: 326.23,
      low: 325.33,
      time: "2026-11-03T09:30:00-05:00",
      volume: 8519,
    });
  });

  it("extracts daily candles ending at the previous close", () => {
    const q = parsed();
    expect(q.daily.length).toBe(21);
    expect(q.daily[q.daily.length - 1].close).toBeCloseTo(q.previousClose, 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/parse.test.ts`
Expected: FAIL — `intraday.length` is 0.

- [ ] **Step 3: Add candle extraction to `src/parse.ts`**

Add above `parseGoogleFinance`:

```ts
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T/;

function toCandle(x: unknown): Candle | undefined {
  if (!Array.isArray(x) || x.length < 6) return undefined;
  const [open, close, high, low, time, volume] = x;
  if (!isNum(open) || !isNum(close) || !isNum(high) || !isNum(low) || !isNum(volume)) return undefined;
  if (!isStr(time) || !ISO_TIME.test(time)) return undefined;
  return { open, close, high, low, time, volume };
}

/** First array inside `root` whose elements are all candles (at least 2). */
function findCandles(root: unknown): Candle[] {
  for (const a of walk(root)) {
    if (a.length < 2) continue;
    const candles = a.map(toCandle);
    if (candles.every((c): c is Candle => c !== undefined)) return candles;
  }
  return [];
}

/**
 * Chart entries look like `[[SYM,EXCH], mid, currency, [series…], …, intervalSeconds, 0]`.
 * Returns the longest candle list per interval (300 = 5-minute, 86400 = daily).
 */
function findChartCandles(blobs: unknown[], symbol: string, exchange: string): Map<number, Candle[]> {
  const byInterval = new Map<number, Candle[]>();
  const entries = findAll(
    blobs,
    (a) =>
      Array.isArray(a[0]) &&
      a[0][0] === symbol &&
      a[0][1] === exchange &&
      isStr(a[1]) &&
      isStr(a[2]) &&
      Array.isArray(a[3]) &&
      isNum(a[a.length - 2]),
  );
  for (const e of entries) {
    const interval = e[e.length - 2] as number;
    const candles = findCandles(e[3]);
    if (candles.length > (byInterval.get(interval)?.length ?? 0)) byInterval.set(interval, candles);
  }
  return byInterval;
}
```

In `parseGoogleFinance`, before `const quote`, add:

```ts
  const candles = findChartCandles(blobs, symbol, exchange);
```

and set `intraday: candles.get(300) ?? [],` and `daily: candles.get(86400) ?? [],`. Import `Candle`: `import type { Candle, ParseResult, Quote, Stats } from "./types";`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/parse.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/parse.ts test/parse.test.ts
git commit -m "feat: parse intraday and daily candles"
```

---

### Task 6: Parser — news

**Files:**
- Modify: `src/parse.ts`
- Test: `test/parse.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe("parseGoogleFinance: news", () => {
  it("extracts de-duplicated news, newest first", () => {
    const news = parsed().news;
    expect(news.length).toBeGreaterThanOrEqual(10);
    for (const n of news) {
      expect(n.url).toMatch(/^https?:\/\//);
      expect(n.title.length).toBeGreaterThan(5);
      expect(n.source.length).toBeGreaterThan(0);
      expect(n.publishedAt).toBeGreaterThan(1_700_000_000);
    }
    expect(new Set(news.map((n) => n.url)).size).toBe(news.length);
    const times = news.map((n) => n.publishedAt);
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/parse.test.ts`
Expected: FAIL — `news.length` is 0.

- [ ] **Step 3: Add news extraction to `src/parse.ts`**

Add above `parseGoogleFinance`:

```ts
const MAX_NEWS = 20;

/** `["https://…", title, source, faviconUrl, publishedAtEpochSeconds, …]` */
function findNews(blobs: unknown[]): NewsItem[] {
  const byUrl = new Map<string, NewsItem>();
  for (const a of findAll(
    blobs,
    (a) =>
      isStr(a[0]) &&
      /^https?:\/\//.test(a[0]) &&
      isStr(a[1]) &&
      a[1].length > 0 &&
      isStr(a[2]) &&
      a[2].length > 0 &&
      isNum(a[4]),
  )) {
    const url = a[0] as string;
    if (!byUrl.has(url)) {
      byUrl.set(url, { url, title: a[1] as string, source: a[2] as string, publishedAt: a[4] as number });
    }
  }
  return [...byUrl.values()].sort((x, y) => y.publishedAt - x.publishedAt).slice(0, MAX_NEWS);
}
```

Set `news: findNews(blobs),` in the quote object; import `NewsItem` from `./types`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/parse.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/parse.ts test/parse.test.ts
git commit -m "feat: parse news items"
```

---

### Task 7: Formatting helpers

**Files:**
- Create: `src/format.ts`
- Test: `test/format.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { compact, money, signed, timeAgo } from "../src/format";

describe("compact", () => {
  it.each([
    [4842494830169, "4.84T"],
    [39698332, "39.70M"],
    [2_500_000_000, "2.50B"],
    [12_500, "12.50K"],
    [999, "999"],
  ])("%d -> %s", (n, out) => expect(compact(n)).toBe(out));
});

describe("money", () => {
  it("formats USD", () => expect(money(331.775, "USD")).toBe("$331.78"));
  it("falls back for an invalid currency code", () => expect(money(1.5, "ZZZZ")).toBe("1.50 ZZZZ"));
});

describe("signed", () => {
  it("adds a plus sign for positives", () => expect(signed(1.234)).toBe("+1.23"));
  it("keeps the minus for negatives", () => expect(signed(-6.5)).toBe("-6.50"));
  it("shows zero without a sign", () => expect(signed(0)).toBe("0.00"));
  it("does not show negative zero after rounding", () => expect(signed(-0.001)).toBe("0.00"));
});

describe("timeAgo", () => {
  const now = 1_800_000_000_000;
  const at = (secondsAgo: number) => now / 1000 - secondsAgo;
  it("seconds", () => expect(timeAgo(at(30), now)).toBe("just now"));
  it("minutes", () => expect(timeAgo(at(5 * 60), now)).toBe("5m ago"));
  it("hours", () => expect(timeAgo(at(3 * 3600), now)).toBe("3h ago"));
  it("days", () => expect(timeAgo(at(2 * 86400), now)).toBe("2d ago"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/format.test.ts`
Expected: FAIL — cannot find module `../src/format`.

- [ ] **Step 3: Write `src/format.ts`**

```ts
export function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(2)}K`;
  return String(Math.round(n));
}

export function money(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

export function signed(n: number, digits = 2): string {
  const s = n.toFixed(digits);
  if (Number(s) === 0) return (0).toFixed(digits);
  return n > 0 ? `+${s}` : s;
}

export function timeAgo(epochSeconds: number, nowMs: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor(nowMs / 1000 - epochSeconds));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
```

Note: `compact(12_500)` returns `"12.50K"` because the threshold for K is `1e4`; `compact(999)` returns `"999"`. The test table above is consistent with that.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/format.test.ts`
Expected: PASS. (If `money(1.5,"ZZZZ")` does not throw in this Node version, `Intl` accepts any 3-letter code but `ZZZZ` is 4 letters, so it throws a RangeError and the fallback runs.)

- [ ] **Step 5: Commit**

```bash
git add src/format.ts test/format.test.ts
git commit -m "feat: add number and time formatting helpers"
```

---

### Task 8: Chart SVG + embedding

**Files:**
- Create: `src/chart.ts`, `src/chartImage.ts`
- Test: `test/chart.test.ts`

- [ ] **Step 1: Write the failing test `test/chart.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { buildChartSvg, sparkline, svgToDataUri } from "../src/chart";
import type { Candle } from "../src/types";

const candle = (close: number, i: number): Candle => ({
  open: close,
  close,
  high: close,
  low: close,
  time: `2026-11-0${i + 1}T16:00:00-05:00`,
  volume: 1,
});

describe("buildChartSvg", () => {
  it("returns null with fewer than 2 candles", () => {
    expect(buildChartSvg([candle(1, 0)])).toBeNull();
  });

  it("draws one path point per candle", () => {
    const svg = buildChartSvg([1, 2, 3, 2].map(candle))!;
    expect(svg.startsWith("<svg")).toBe(true);
    const line = svg.match(/<path class="line" d="([^"]+)"/)![1];
    expect(line.split(" L").length).toBe(4);
  });

  it("is green when the last close is above the reference, red otherwise", () => {
    expect(buildChartSvg([1, 2].map(candle))).toContain("#34a853");
    expect(buildChartSvg([2, 1].map(candle))).toContain("#ea4335");
    expect(buildChartSvg([1, 2].map(candle), { previousClose: 5 })).toContain("#ea4335");
  });

  it("does not divide by zero on a flat series", () => {
    const svg = buildChartSvg([5, 5, 5].map(candle))!;
    expect(svg).not.toContain("NaN");
  });
});

describe("svgToDataUri", () => {
  it("base64-encodes the svg", () => {
    expect(svgToDataUri("<svg/>")).toBe("data:image/svg+xml;base64,PHN2Zy8+");
  });
});

describe("sparkline", () => {
  it("maps min to the lowest block and max to the highest", () => {
    expect(sparkline([1, 2, 3, 4, 5, 6, 7, 8].map(candle))).toBe("▁▂▃▄▅▆▇█");
  });
  it("is empty for no candles", () => {
    expect(sparkline([])).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/chart.test.ts`
Expected: FAIL — cannot find module `../src/chart`.

- [ ] **Step 3: Write `src/chart.ts`**

```ts
import type { Candle } from "./types";

export interface ChartOptions {
  width?: number;
  height?: number;
  /** Dashed reference line and up/down colour reference (1D chart). */
  previousClose?: number;
}

const UP = "#34a853";
const DOWN = "#ea4335";

export function buildChartSvg(candles: Candle[], options: ChartOptions = {}): string | null {
  if (candles.length < 2) return null;
  const width = options.width ?? 640;
  const height = options.height ?? 240;
  const pad = 8;
  const closes = candles.map((c) => c.close);
  const reference = options.previousClose;
  const values = reference === undefined ? closes : [...closes, reference];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;

  const x = (i: number) => pad + (i / (closes.length - 1)) * (width - 2 * pad);
  const y = (v: number) => pad + (1 - (v - lo) / span) * (height - 2 * pad);
  const point = (i: number) => `${x(i).toFixed(1)} ${y(closes[i]).toFixed(1)}`;

  const up = closes[closes.length - 1] >= (reference ?? closes[0]);
  const color = up ? UP : DOWN;
  const line = closes.map((_, i) => `${i === 0 ? "M" : "L"}${point(i)}`).join(" ");
  const area = `${line} L${x(closes.length - 1).toFixed(1)} ${height - pad} L${x(0).toFixed(1)} ${height - pad} Z`;
  const refLine =
    reference === undefined
      ? ""
      : `<line x1="${pad}" x2="${width - pad}" y1="${y(reference).toFixed(1)}" y2="${y(reference).toFixed(1)}" stroke="#888" stroke-width="1" stroke-dasharray="4 4"/>`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<path d="${area}" fill="${color}" fill-opacity="0.12"/>` +
    refLine +
    `<path class="line" d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>` +
    `</svg>`
  );
}

export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

const BLOCKS = "▁▂▃▄▅▆▇█";

/** Text fallback chart. */
export function sparkline(candles: Candle[]): string {
  if (candles.length === 0) return "";
  const closes = candles.map((c) => c.close);
  const lo = Math.min(...closes);
  const span = Math.max(...closes) - lo || 1;
  return closes.map((c) => BLOCKS[Math.min(7, Math.floor(((c - lo) / span) * 8))]).join("");
}
```

Note the `sparkline` test: with closes 1..8, `lo=1`, `span=7`; values map to indices `floor((c-1)/7*8)` = 0,1,2,3,4,5,6,8→capped 7. Index sequence 0,1,2,3,4,5,6,7 → `▁▂▃▄▅▆▇█` ✓.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/chart.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Write `src/chartImage.ts`** (uses the winner recorded in Task 1, Step 6)

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sparkline, svgToDataUri } from "./chart";
import type { Candle } from "./types";

/** Result of the Task 1 spike. One of: "data-uri" | "file-url" | "file-path" | "sparkline". */
export const CHART_MODE: "data-uri" | "file-url" | "file-path" | "sparkline" = "data-uri";

/** Markdown for the chart. `key` names the temp file for the file-based modes. */
export function chartMarkdown(svg: string | null, candles: Candle[], key: string): string {
  if (!svg) return "_No chart data available._";
  switch (CHART_MODE) {
    case "data-uri":
      return `![chart](${svgToDataUri(svg)})`;
    case "file-url":
    case "file-path": {
      const dir = join(tmpdir(), "tinycast-stocks");
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `${key.replace(/[^A-Za-z0-9_-]/g, "_")}.svg`);
      writeFileSync(file, svg);
      return CHART_MODE === "file-url" ? `![chart](file://${file})` : `![chart](${file})`;
    }
    case "sparkline":
      return `\`${sparkline(candles)}\``;
  }
}
```

Set `CHART_MODE` to the variant that rendered in Task 1, Step 6 (A → `"data-uri"`, B → `"file-url"`, C → `"file-path"`, D → `"sparkline"`).

- [ ] **Step 6: Commit**

```bash
git add src/chart.ts src/chartImage.ts test/chart.test.ts
git commit -m "feat: build SVG price chart with fallbacks"
```

---

### Task 9: HTTP layer and Google fetch with exchange probing

**Files:**
- Create: `src/http.ts`, `src/cache.ts`, `src/google.ts`
- Test: `test/google.test.ts`, `test/cache.test.ts`

- [ ] **Step 1: Write `src/http.ts`**

```ts
export const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface FetchResponse {
  ok: boolean;
  status: number;
  url: string;
  text(): Promise<string>;
}

export type Fetcher = (
  url: string,
  init: { headers: Record<string, string>; signal?: AbortSignal },
) => Promise<FetchResponse>;

export const defaultFetcher: Fetcher = (url, init) => fetch(url, init);
```

- [ ] **Step 2: Write the failing test `test/cache.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { getFresh, putFresh, type KV } from "../src/cache";

function memoryKV(): KV {
  const m = new Map<string, string>();
  return { get: async (k) => m.get(k), set: async (k, v) => void m.set(k, v) };
}

describe("cache", () => {
  it("returns a value within its TTL", async () => {
    const kv = memoryKV();
    await putFresh(kv, "k", { a: 1 }, 1000);
    expect(await getFresh(kv, "k", 60_000, 31_000)).toEqual({ a: 1 });
  });

  it("returns undefined after the TTL", async () => {
    const kv = memoryKV();
    await putFresh(kv, "k", { a: 1 }, 1000);
    expect(await getFresh(kv, "k", 60_000, 62_000)).toBeUndefined();
  });

  it("returns undefined for a missing or corrupt entry", async () => {
    const kv = memoryKV();
    expect(await getFresh(kv, "nope", 1000, 0)).toBeUndefined();
    await kv.set("bad", "{not json");
    expect(await getFresh(kv, "bad", 1000, 0)).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run it to verify it fails, then write `src/cache.ts`**

Run: `npx vitest run test/cache.test.ts` → FAIL (module missing).

```ts
export interface KV {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

interface Entry<T> {
  at: number;
  value: T;
}

export async function getFresh<T>(kv: KV, key: string, ttlMs: number, now: number = Date.now()): Promise<T | undefined> {
  const raw = await kv.get(key);
  if (!raw) return undefined;
  try {
    const entry = JSON.parse(raw) as Entry<T>;
    return now - entry.at <= ttlMs ? entry.value : undefined;
  } catch {
    return undefined;
  }
}

export async function putFresh<T>(kv: KV, key: string, value: T, now: number = Date.now()): Promise<void> {
  await kv.set(key, JSON.stringify({ at: now, value } satisfies Entry<T>));
}
```

Run: `npx vitest run test/cache.test.ts` → PASS (3 tests).

- [ ] **Step 4: Write the failing test `test/google.test.ts`**

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { KV } from "../src/cache";
import { fetchQuote, quoteUrl } from "../src/google";
import type { FetchResponse, Fetcher } from "../src/http";

const html = readFileSync(join(__dirname, "fixtures/AAPL-NASDAQ-2026-11-03.html"), "utf8");

const page = (body: string, status = 200, url = "https://www.google.com/finance/quote/x"): FetchResponse => ({
  ok: status >= 200 && status < 300,
  status,
  url,
  text: async () => body,
});

function memoryKV(): KV {
  const m = new Map<string, string>();
  return { get: async (k) => m.get(k), set: async (k, v) => void m.set(k, v) };
}

describe("quoteUrl", () => {
  it("builds the Google Finance URL", () => {
    expect(quoteUrl("AAPL", "NASDAQ")).toBe("https://www.google.com/finance/quote/AAPL:NASDAQ");
  });
});

describe("fetchQuote", () => {
  it("returns the quote on the first matching exchange", async () => {
    const calls: string[] = [];
    const fetcher: Fetcher = async (url) => {
      calls.push(url);
      return page(html);
    };
    const r = await fetchQuote("aapl", { fetcher });
    expect(r.ok).toBe(true);
    expect(calls).toEqual([quoteUrl("AAPL", "NASDAQ")]);
  });

  it("probes further exchanges when the first is a 404, then remembers the hint", async () => {
    const hints = memoryKV();
    const calls: string[] = [];
    const fetcher: Fetcher = async (url) => {
      calls.push(url);
      return url.endsWith(":NYSE") ? page(html.replaceAll("NASDAQ", "NYSE")) : page("", 404);
    };
    const r = await fetchQuote("AAPL", { fetcher, hints });
    expect(r.ok && r.quote.exchange).toBe("NYSE");
    expect(calls.length).toBe(2);
    expect(await hints.get("exchange:AAPL")).toBe("NYSE");

    calls.length = 0;
    await fetchQuote("AAPL", { fetcher, hints });
    expect(calls).toEqual([quoteUrl("AAPL", "NYSE")]);
  });

  it("stops immediately on HTTP 429 with a blocked failure", async () => {
    let n = 0;
    const fetcher: Fetcher = async () => (n++, page("", 429));
    const r = await fetchQuote("AAPL", { fetcher });
    expect(r).toMatchObject({ ok: false, kind: "blocked" });
    expect(n).toBe(1);
  });

  it("stops immediately on a consent redirect", async () => {
    const fetcher: Fetcher = async () => page("", 200, "https://consent.google.com/m?continue=x");
    expect(await fetchQuote("AAPL", { fetcher })).toMatchObject({ ok: false, kind: "blocked" });
  });

  it("stops on a layout failure instead of probing every exchange", async () => {
    let n = 0;
    const fetcher: Fetcher = async () => (n++, page("<html>changed</html>"));
    const r = await fetchQuote("AAPL", { fetcher });
    expect(r).toMatchObject({ ok: false, kind: "layout" });
    expect(n).toBe(1);
  });

  it("returns not-found when no exchange has the symbol", async () => {
    const fetcher: Fetcher = async () => page("", 404);
    expect(await fetchQuote("ZZZZZ", { fetcher })).toMatchObject({ ok: false, kind: "not-found" });
  });
});
```

- [ ] **Step 5: Run it to verify it fails, then write `src/google.ts`**

Run: `npx vitest run test/google.test.ts` → FAIL (module missing).

```ts
import type { KV } from "./cache";
import { defaultFetcher, UA, type Fetcher } from "./http";
import { parseGoogleFinance } from "./parse";
import type { ParseResult } from "./types";

export const EXCHANGES = [
  "NASDAQ",
  "NYSE",
  "NYSEARCA",
  "NYSEAMERICAN",
  "BATS",
  "MUTF",
  "TSE",
  "LON",
  "ASX",
  "HKG",
  "NSE",
  "BOM",
  "ETR",
  "TYO",
];

export const quoteUrl = (symbol: string, exchange: string) =>
  `https://www.google.com/finance/quote/${encodeURIComponent(symbol)}:${exchange}`;

export interface FetchQuoteOptions {
  fetcher?: Fetcher;
  /** Remembers which exchange worked for a symbol. */
  hints?: KV;
  signal?: AbortSignal;
}

/**
 * Fetch and parse a Google Finance quote. Tries the remembered exchange first, then the rest.
 * Blocking (403/429/consent) and layout failures stop immediately so we never hammer Google.
 * Network errors (including AbortError) propagate to the caller.
 */
export async function fetchQuote(symbol: string, options: FetchQuoteOptions = {}): Promise<ParseResult> {
  const fetcher = options.fetcher ?? defaultFetcher;
  const sym = symbol.toUpperCase();
  const hint = await options.hints?.get(`exchange:${sym}`);
  const order = [...(hint ? [hint] : []), ...EXCHANGES.filter((e) => e !== hint)];

  let last: ParseResult = { ok: false, kind: "not-found", reason: `No Google Finance listing found for ${sym}.` };
  for (const exchange of order) {
    const res = await fetcher(quoteUrl(sym, exchange), {
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
      signal: options.signal,
    });
    if (res.url.includes("consent.google.com")) {
      return { ok: false, kind: "blocked", reason: "Google asked for cookie consent; scripted access is blocked." };
    }
    if (res.status === 403 || res.status === 429) {
      return {
        ok: false,
        kind: "blocked",
        reason: `Google Finance blocked the request (HTTP ${res.status}). Try again in a few minutes.`,
      };
    }
    if (!res.ok) continue;

    const parsed = parseGoogleFinance(await res.text(), sym, exchange);
    if (parsed.ok) {
      await options.hints?.set(`exchange:${sym}`, exchange);
      return parsed;
    }
    if (parsed.kind === "layout") return parsed;
    last = parsed;
  }
  return last;
}
```

Run: `npx vitest run test/google.test.ts` → PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/http.ts src/cache.ts src/google.ts test/cache.test.ts test/google.test.ts
git commit -m "feat: fetch Google Finance quotes with exchange probing and safe failure modes"
```

---

### Task 10: Search

**Files:**
- Create: `src/search.ts`
- Test: `test/search.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import type { FetchResponse, Fetcher } from "../src/http";
import { searchStocks } from "../src/search";

const json = (body: unknown, status = 200): FetchResponse => ({
  ok: status < 400,
  status,
  url: "https://stockanalysis.com/api/search",
  text: async () => JSON.stringify(body),
});

describe("searchStocks", () => {
  it("returns an empty list for a blank query without calling the network", async () => {
    let called = false;
    const fetcher: Fetcher = async () => ((called = true), json({}));
    expect(await searchStocks("   ", { fetcher })).toEqual([]);
    expect(called).toBe(false);
  });

  it("keeps stocks and ETFs, drops other types and slash symbols, caps at 8", async () => {
    const data = [
      { s: "AAPL", n: "Apple Inc.", t: "s" },
      { s: "SPY", n: "SPDR S&P 500", t: "e" },
      { s: "BTC/USD", n: "Bitcoin", t: "s" },
      { s: "XYZ", n: "Index thing", t: "i" },
      ...Array.from({ length: 12 }, (_, i) => ({ s: `T${i}`, n: `Name ${i}`, t: "s" })),
    ];
    const fetcher: Fetcher = async () => json({ data });
    const hits = await searchStocks("a", { fetcher });
    expect(hits[0]).toEqual({ symbol: "AAPL", name: "Apple Inc.", type: "Stock" });
    expect(hits[1]).toEqual({ symbol: "SPY", name: "SPDR S&P 500", type: "ETF" });
    expect(hits.map((h) => h.symbol)).not.toContain("BTC/USD");
    expect(hits.map((h) => h.symbol)).not.toContain("XYZ");
    expect(hits.length).toBe(8);
  });

  it("throws a readable error on HTTP failure", async () => {
    const fetcher: Fetcher = async () => json({}, 503);
    await expect(searchStocks("apple", { fetcher })).rejects.toThrow("Search failed (HTTP 503)");
  });

  it("returns an empty list when the payload has no data array", async () => {
    const fetcher: Fetcher = async () => json({ nope: true });
    expect(await searchStocks("apple", { fetcher })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails, then write `src/search.ts`**

Run: `npx vitest run test/search.test.ts` → FAIL (module missing).

```ts
import { defaultFetcher, UA, type Fetcher } from "./http";

export interface SearchHit {
  symbol: string;
  name: string;
  type: "Stock" | "ETF";
}

const MAX_HITS = 8;

interface RawHit {
  s?: string;
  n?: string;
  t?: string;
}

export async function searchStocks(
  query: string,
  options: { fetcher?: Fetcher; signal?: AbortSignal } = {},
): Promise<SearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  const fetcher = options.fetcher ?? defaultFetcher;
  const res = await fetcher(`https://stockanalysis.com/api/search?q=${encodeURIComponent(q)}`, {
    headers: { "User-Agent": UA },
    signal: options.signal,
  });
  if (!res.ok) throw new Error(`Search failed (HTTP ${res.status})`);

  const body = JSON.parse(await res.text()) as { data?: RawHit[] };
  if (!Array.isArray(body.data)) return [];

  const hits: SearchHit[] = [];
  for (const raw of body.data) {
    if (!raw.s || !raw.n || raw.s.includes("/")) continue;
    if (raw.t !== "s" && raw.t !== "e") continue;
    hits.push({ symbol: raw.s, name: raw.n, type: raw.t === "e" ? "ETF" : "Stock" });
    if (hits.length >= MAX_HITS) break;
  }
  return hits;
}
```

Run: `npx vitest run test/search.test.ts` → PASS (4 tests).

- [ ] **Step 3: Commit**

```bash
git add src/search.ts test/search.test.ts
git commit -m "feat: add ticker search via stockanalysis.com"
```

---

### Task 11: Favorites

**Files:**
- Create: `src/favorites.ts`
- Test: `test/favorites.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { parseFavs, toggleFav } from "../src/favorites";

const aapl = { symbol: "AAPL", name: "Apple Inc." };
const msft = { symbol: "MSFT", name: "Microsoft" };

describe("toggleFav", () => {
  it("adds a missing favorite at the end", () => {
    expect(toggleFav([aapl], msft)).toEqual([aapl, msft]);
  });
  it("removes an existing favorite", () => {
    expect(toggleFav([aapl, msft], aapl)).toEqual([msft]);
  });
});

describe("parseFavs", () => {
  it("parses a valid list", () => {
    expect(parseFavs(JSON.stringify([aapl]))).toEqual([aapl]);
  });
  it("returns [] for undefined, junk, or the wrong shape", () => {
    expect(parseFavs(undefined)).toEqual([]);
    expect(parseFavs("{nope")).toEqual([]);
    expect(parseFavs(JSON.stringify({ a: 1 }))).toEqual([]);
    expect(parseFavs(JSON.stringify([{ symbol: 1 }, aapl]))).toEqual([aapl]);
  });
});
```

- [ ] **Step 2: Run to verify it fails, then write `src/favorites.ts`**

Run: `npx vitest run test/favorites.test.ts` → FAIL.

```ts
export interface Fav {
  symbol: string;
  name: string;
}

export const FAVORITES_KEY = "favorites";

export function toggleFav(favs: Fav[], fav: Fav): Fav[] {
  return favs.some((f) => f.symbol === fav.symbol) ? favs.filter((f) => f.symbol !== fav.symbol) : [...favs, fav];
}

export function parseFavs(raw: string | undefined): Fav[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter(
      (f): f is Fav => !!f && typeof f.symbol === "string" && typeof f.name === "string",
    );
  } catch {
    return [];
  }
}
```

Run: `npx vitest run test/favorites.test.ts` → PASS (4 tests).

- [ ] **Step 3: Commit**

```bash
git add src/favorites.ts test/favorites.test.ts
git commit -m "feat: add favorites helpers"
```

---

### Task 12: Raycast-bound code — KV, hook, and UI

These files import `@raycast/api`, so they are not unit-tested; they are verified by the build (Step 5) and a manual check (Task 13).

**Files:**
- Create: `src/kv.ts`, `src/useQuote.ts`
- Modify (replace spike): `src/index.tsx`

- [ ] **Step 1: Write `src/kv.ts`**

```ts
import { LocalStorage } from "@raycast/api";
import type { KV } from "./cache";

export const raycastKV: KV = {
  get: async (key) => (await LocalStorage.getItem<string>(key)) ?? undefined,
  set: (key, value) => LocalStorage.setItem(key, value),
};
```

- [ ] **Step 2: Write `src/useQuote.ts`**

```ts
import { useEffect, useState } from "react";
import { getFresh, putFresh } from "./cache";
import { fetchQuote } from "./google";
import { raycastKV } from "./kv";
import type { ParseResult } from "./types";

const QUOTE_TTL_MS = 60_000;
const SELECTION_DEBOUNCE_MS = 250;

export type QuoteState =
  | { symbol: string; status: "loading" }
  | { symbol: string; status: "done"; result: ParseResult };

/** Fetches the quote for `symbol` once the selection settles. Cancels in-flight work on change. */
export function useQuote(symbol: string | undefined, refreshKey = 0): QuoteState | undefined {
  const [state, setState] = useState<QuoteState>();

  useEffect(() => {
    if (!symbol) {
      setState(undefined);
      return;
    }
    const abort = new AbortController();
    setState({ symbol, status: "loading" });

    const timer = setTimeout(async () => {
      try {
        const cacheKey = `quote:${symbol}`;
        const cached = refreshKey === 0 ? await getFresh<ParseResult>(raycastKV, cacheKey, QUOTE_TTL_MS) : undefined;
        const result = cached ?? (await fetchQuote(symbol, { hints: raycastKV, signal: abort.signal }));
        if (!cached && result.ok) await putFresh(raycastKV, cacheKey, result);
        if (!abort.signal.aborted) setState({ symbol, status: "done", result });
      } catch (error) {
        if (abort.signal.aborted) return;
        const reason = error instanceof Error ? error.message : String(error);
        setState({ symbol, status: "done", result: { ok: false, kind: "network", reason } });
      }
    }, SELECTION_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [symbol, refreshKey]);

  return state;
}
```

- [ ] **Step 3: Replace `src/index.tsx` with the real UI**

```tsx
import { Action, ActionPanel, Color, Icon, List, LocalStorage } from "@raycast/api";
import { useEffect, useState } from "react";
import { buildChartSvg } from "./chart";
import { chartMarkdown } from "./chartImage";
import { compact, money, signed, timeAgo } from "./format";
import { FAVORITES_KEY, parseFavs, toggleFav, type Fav } from "./favorites";
import { quoteUrl } from "./google";
import { searchStocks, type SearchHit } from "./search";
import type { Quote } from "./types";
import { useQuote, type QuoteState } from "./useQuote";

type Range = "1D" | "1M";

const SEARCH_DEBOUNCE_MS = 200;

function detailMarkdown(q: Quote, range: Range): string {
  const candles = range === "1D" ? q.intraday : q.daily;
  const svg = buildChartSvg(candles, { previousClose: range === "1D" ? q.previousClose : undefined });
  const color = q.change >= 0 ? "🟢" : "🔴";
  const updated = q.updatedAt ? ` · updated ${timeAgo(q.updatedAt)}` : "";
  const head = `# ${q.name} (${q.symbol})\n\n${color} **${money(q.price, q.currency)}**  ${signed(q.change)} (${signed(q.changePercent)}%)${updated}`;
  const chart = chartMarkdown(svg, candles, `${q.symbol}-${range}`);
  const news = q.news.length
    ? q.news.map((n) => `- [${n.title}](${n.url}) — ${n.source} · ${timeAgo(n.publishedAt)}`).join("\n")
    : "_No news found._";
  return `${head}\n\n${chart}\n\n_Range: ${range}_\n\n### News\n\n${news}`;
}

function QuoteDetail({ state, range }: { state: QuoteState | undefined; range: Range }) {
  if (!state || state.status === "loading") return <List.Item.Detail isLoading markdown="Loading quote…" />;
  const result = state.result;
  if (!result.ok) {
    return (
      <List.Item.Detail markdown={`## Quote unavailable\n\n${result.reason}\n\n_Reason: ${result.kind}_`} />
    );
  }
  const q = result.quote;
  const s = q.stats;
  const label = (title: string, text: string | undefined) =>
    text === undefined ? null : <List.Item.Detail.Metadata.Label key={title} title={title} text={text} />;
  const num = (n: number | undefined, f: (n: number) => string) => (n === undefined ? undefined : f(n));

  return (
    <List.Item.Detail
      markdown={detailMarkdown(q, range)}
      metadata={
        <List.Item.Detail.Metadata>
          {label("Open", num(s.open, (n) => money(n, q.currency)))}
          {label("High", num(s.high, (n) => money(n, q.currency)))}
          {label("Low", num(s.low, (n) => money(n, q.currency)))}
          {label("Prev Close", money(q.previousClose, q.currency))}
          <List.Item.Detail.Metadata.Separator />
          {label("Market Cap", num(s.marketCap, compact))}
          {label("Volume", num(s.volume, compact))}
          {label("Avg Volume", num(s.avgVolume, compact))}
          <List.Item.Detail.Metadata.Separator />
          {label("52-Wk High", num(s.yearHigh, (n) => money(n, q.currency)))}
          {label("52-Wk Low", num(s.yearLow, (n) => money(n, q.currency)))}
          {label("P/E", num(s.peRatio, (n) => n.toFixed(2)))}
          {label("EPS", num(s.eps, (n) => n.toFixed(2)))}
          {label("Beta", num(s.beta, (n) => n.toFixed(2)))}
          <List.Item.Detail.Metadata.Separator />
          {label("Shares Out", num(s.sharesOutstanding, compact))}
          {label("Employees", num(s.employees, (n) => n.toLocaleString("en-US")))}
        </List.Item.Detail.Metadata>
      }
    />
  );
}

export default function Command() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string>();
  const [favs, setFavs] = useState<Fav[]>([]);
  const [selected, setSelected] = useState<string>();
  const [range, setRange] = useState<Range>("1D");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    LocalStorage.getItem<string>(FAVORITES_KEY).then((raw) => setFavs(parseFavs(raw)));
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits([]);
      setSearchError(undefined);
      setSearching(false);
      return;
    }
    const abort = new AbortController();
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const result = await searchStocks(q, { signal: abort.signal });
        if (abort.signal.aborted) return;
        setHits(result);
        setSearchError(undefined);
      } catch (error) {
        if (abort.signal.aborted) return;
        setHits([]);
        setSearchError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!abort.signal.aborted) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query]);

  const quoteState = useQuote(selected, refreshKey);

  const rows: Fav[] = query.trim() ? hits.map((h) => ({ symbol: h.symbol, name: h.name })) : favs;
  const isFav = (symbol: string) => favs.some((f) => f.symbol === symbol);

  async function toggleFavorite(fav: Fav) {
    const next = toggleFav(favs, fav);
    setFavs(next);
    await LocalStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
  }

  const exchangeForUrl = quoteState?.status === "done" && quoteState.result.ok ? quoteState.result.quote.exchange : "NASDAQ";

  return (
    <List
      isLoading={searching}
      isShowingDetail
      searchBarPlaceholder="Search company or ticker…"
      onSearchTextChange={setQuery}
      onSelectionChange={(id) => setSelected(id ?? undefined)}
      throttle
    >
      {searchError ? (
        <List.EmptyView icon={Icon.ExclamationMark} title="Search failed" description={searchError} />
      ) : rows.length === 0 ? (
        <List.EmptyView
          icon={Icon.MagnifyingGlass}
          title={query.trim() ? "No matches" : "Type a company name or ticker"}
          description={query.trim() ? undefined : "Star a result with ⌘⇧F to pin it here."}
        />
      ) : (
        <List.Section title={query.trim() ? "Search Results" : "Favorites"}>
          {rows.map((row) => (
            <List.Item
              key={row.symbol}
              id={row.symbol}
              title={row.symbol}
              subtitle={row.name}
              accessories={isFav(row.symbol) ? [{ icon: { source: Icon.Star, tintColor: Color.Yellow } }] : []}
              detail={<QuoteDetail state={quoteState?.symbol === row.symbol ? quoteState : undefined} range={range} />}
              actions={
                <ActionPanel>
                  <Action.OpenInBrowser title="Open in Google Finance" url={quoteUrl(row.symbol, exchangeForUrl)} />
                  <Action
                    title={range === "1D" ? "Show 1-Month Chart" : "Show 1-Day Chart"}
                    icon={Icon.LineChart}
                    shortcut={{ modifiers: ["cmd"], key: "r" }}
                    onAction={() => setRange(range === "1D" ? "1M" : "1D")}
                  />
                  <Action
                    title={isFav(row.symbol) ? "Remove from Favorites" : "Add to Favorites"}
                    icon={Icon.Star}
                    shortcut={{ modifiers: ["cmd", "shift"], key: "f" }}
                    onAction={() => toggleFavorite(row)}
                  />
                  <Action
                    title="Refresh Quote"
                    icon={Icon.ArrowClockwise}
                    shortcut={{ modifiers: ["cmd", "shift"], key: "r" }}
                    onAction={() => setRefreshKey((k) => k + 1)}
                  />
                  {quoteState?.status === "done" && quoteState.result.ok && quoteState.symbol === row.symbol && (
                    <Action.CopyToClipboard
                      title="Copy Price"
                      content={quoteState.result.quote.price.toFixed(2)}
                    />
                  )}
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}
    </List>
  );
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: no errors. (If `raycast-env.d.ts` is missing, `ray build` generates it; the `include` entry tolerates its absence.) Fix any type errors before continuing.

- [ ] **Step 5: Build**

Run: `npx ray build`
Expected: build succeeds and writes the bundle to `~/.config/raycast/extensions/tinycast-stocks/` (or use the `-o` form from Task 1, Step 5).

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: all test files pass.

- [ ] **Step 7: Commit**

```bash
git add src/kv.ts src/useQuote.ts src/index.tsx
git commit -m "feat: stock search UI with quote, stats, chart, news and favorites"
```

---

### Task 13: Manual verification in Tinycast (human + me)

- [ ] **Step 1:** Open Tinycast → Stocks → type `apple`. Expected: rows `AAPL …` with company names (no "Loading quote…" rows).
- [ ] **Step 2:** Highlight `AAPL`. Expected: after ~0.25 s the detail pane shows price, change, chart, stats and news. Record what you see (screenshot welcome).
- [ ] **Step 3:** Press `⌘R`. Expected: chart toggles between 1D and 1M.
- [ ] **Step 4:** Press `⌘⇧F`, clear the search box. Expected: AAPL appears under Favorites with a star.
- [ ] **Step 5:** Failure state: turn off Wi-Fi, highlight a different symbol. Expected: "Quote unavailable … Reason: network" instead of a hang.
- [ ] **Step 6:** If any step fails, capture the symptom and use superpowers:systematic-debugging before changing code.

---

### Task 14: Live drift check script

**Files:**
- Create: `scripts/live-check.ts`

- [ ] **Step 1: Write `scripts/live-check.ts`**

```ts
import { fetchQuote } from "../src/google";

const SYMBOLS = process.argv.slice(2).length ? process.argv.slice(2) : ["AAPL", "MSFT", "SPY"];

async function main() {
  let failed = false;
  for (const symbol of SYMBOLS) {
    const r = await fetchQuote(symbol);
    if (!r.ok) {
      failed = true;
      console.log(`FAIL ${symbol}: [${r.kind}] ${r.reason}`);
      continue;
    }
    const q = r.quote;
    const problems = [
      q.stats.marketCap === undefined && "marketCap",
      q.stats.peRatio === undefined && "peRatio",
      q.intraday.length === 0 && "intraday",
      q.daily.length === 0 && "daily",
      q.news.length === 0 && "news",
    ].filter(Boolean);
    if (problems.length) failed = true;
    console.log(
      `${problems.length ? "WARN" : "OK  "} ${symbol}: ${q.price} (${q.exchange}) ` +
        `intraday=${q.intraday.length} daily=${q.daily.length} news=${q.news.length}` +
        (problems.length ? ` missing: ${problems.join(", ")}` : ""),
    );
  }
  process.exit(failed ? 1 : 0);
}

main();
```

- [ ] **Step 2: Run it from a normal terminal** (the Claude sandbox blocks outbound requests)

Run: `! npm run live-check` (in the prompt, so it runs outside the sandbox)
Expected: `OK   AAPL: …` lines. `WARN`/`FAIL` means Google changed something; save that page as a new fixture and extend the parser test first.

- [ ] **Step 3: Commit**

```bash
git add scripts/live-check.ts
git commit -m "chore: add live drift check script"
```

---

### Task 15: Project explainer (`kambaldhage.md`)

Required by the user's global instructions: a detailed, engaging, plain-language explanation of the whole project.

**Files:**
- Create: `kambaldhage.md`

- [ ] **Step 1:** Write `kambaldhage.md` covering, in an engaging voice with analogies (no dry documentation tone):
  - What the project is and why it exists (the old extension broke; the detective story of finding why).
  - Architecture walkthrough: search → select → fetch → parse → render, and how each file fits.
  - Technology choices and why: Raycast-compatible extension on Tinycast, TypeScript, vitest, blob parsing by shape, injectable `Fetcher`.
  - Lessons learned, including the real bugs from this session: (1) rows stuck on "Loading quote…" because failures were swallowed with `continue` and the UI had no failed state; (2) Google removed `data-last-price` and the CSS classes, so scraping by class name is a trap — parse the structured data blobs instead; (3) the `326.21` misread — verify a field by checking `price − previousClose == change` before trusting it; (4) the garbled paste that made `curl` treat `grep` as a hostname; (5) the sandbox proxy returning `HTTP 000`/403 made a test look like a site failure — know which network you are testing from.
  - Pitfalls and how to avoid them: unofficial data sources, rate limiting, fixtures for drift, never probe 17 exchanges per keystroke.
  - Best practices shown: TDD with a real fixture, pure parsers, visible error states, a spike before building UI, debounce + abort for as-you-type search.
- [ ] **Step 2: Commit**

```bash
git add kambaldhage.md
git commit -m "docs: add plain-language project explainer"
```

---

## Self-review

**Spec coverage**

| Spec item | Task |
|---|---|
| Search via stockanalysis.com | 10 |
| Detail fetch on selection only, exchange probing + cached hint | 9, 12 (`useQuote`) |
| Pure shape-based parser, typed `Quote`/`ParseError`, fixture tests | 2–6 |
| Detail pane: header, stats, chart, news; Enter opens Google Finance; copy/favorite | 12 |
| Chart SVG + spike + fallbacks (file, sparkline) | 1, 8 |
| 60-second cache | 9 (`cache.ts`), 12 |
| Visible error states (network, 403/429, consent, layout) | 9, 12 |
| Rate-limit friendly (debounce, abort, single fetch) | 9, 12 |
| `live-check.ts` | 14 |
| Range switching | 12 (1D/1M; other ranges are not in the page, so out of v1) |
| `kambaldhage.md` | 15 |

**Placeholder scan:** none; every code step contains the code. The only decision deferred to runtime is `CHART_MODE`, which Task 1 Step 6 resolves with a concrete A/B/C/D choice and Task 8 Step 5 shows all four code paths.

**Type consistency:** `ParseResult` (with `kind`/`reason`) is defined in Task 2 and used identically in Tasks 3, 9, 12. `Fetcher`/`FetchResponse` are defined in Task 9 (`http.ts`) before `search.ts` (Task 10) uses them. `KV`, `getFresh`, `putFresh` (Task 9) match their use in `kv.ts`/`useQuote.ts` (Task 12). `Fav`/`toggleFav`/`parseFavs`/`FAVORITES_KEY` (Task 11) match `index.tsx`. `quoteUrl` (Task 9) is used by `index.tsx`.

**Known risks to watch during execution**
1. `ray build` output location and author validation (Task 1, Step 5).
2. Whether Tinycast's Raycast runtime supports every component used (`List.Item.Detail.Metadata`, `Action.CopyToClipboard`); Task 13 will show.
3. `⌘R` may collide with a Tinycast shortcut; if so, change the range shortcut in `index.tsx`.
4. News may include related-ticker items (Google mixes them in); v1 shows them all.
