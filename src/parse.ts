import { extractBlobs, walk } from "./blobs";
import type { Candle, FailureKind, NewsItem, ParseResult, Quote, Session, Stats } from "./types";

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

export type BatchResult =
  | { ok: true; candles: Candle[] }
  | { ok: false; kind: FailureKind; reason: string };

const layoutFailure = (reason: string): BatchResult => ({ ok: false, kind: "layout", reason });

function parseBatchUnsafe(text: string, symbol: string, exchange: string): BatchResult {
  let sawRpc = false;
  let best: Candle[] = [];
  for (const line of text.replace(/^\)\]\}'/, "").split("\n")) {
    if (!line.startsWith("[")) continue;
    let chunk: unknown;
    try {
      chunk = JSON.parse(line);
    } catch {
      continue;
    }
    if (!Array.isArray(chunk)) continue;
    for (const item of chunk) {
      if (!Array.isArray(item) || item[0] !== "wrb.fr" || item[1] !== "c2u4wc" || typeof item[2] !== "string") continue;
      sawRpc = true;
      let payload: unknown;
      try {
        payload = JSON.parse(item[2]);
      } catch {
        return layoutFailure("Google Finance returned chart data in an unexpected format.");
      }
      for (const candles of findChartCandles([payload], symbol, exchange).values()) {
        if (candles.length > best.length) best = candles;
      }
    }
  }
  if (!sawRpc) return layoutFailure("Google Finance returned no chart data (the response layout may have changed).");
  if (best.length === 0) return layoutFailure(`No ${symbol}:${exchange} chart candles found in the response.`);
  return { ok: true, candles: best };
}

/** Decodes a `batchexecute` chart response (`)]}'` + length-prefixed chunks). Never throws. */
export function parseBatchExecute(text: string, symbol: string, exchange: string): BatchResult {
  try {
    return parseBatchUnsafe(text, symbol, exchange);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return layoutFailure(`Unexpected error while parsing the chart response: ${message}`);
  }
}

const MAX_NEWS = 20;

const isNewsItem = (a: unknown): a is unknown[] =>
  Array.isArray(a) &&
  isStr(a[0]) &&
  /^https?:\/\//.test(a[0]) &&
  isStr(a[1]) &&
  a[1].length > 0 &&
  isStr(a[2]) &&
  a[2].length > 0 &&
  isNum(a[4]);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wholeWord = (word: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(word)}(?![\\p{L}\\p{N}])`, "iu");

/**
 * News items look like `["https://…", title, source, faviconUrl, publishedAtEpochSeconds, …]`.
 * The page holds several news groups (company news, market-wide headlines…), so pick the group
 * whose titles mention the company or ticker most often.
 */
function findNews(blobs: unknown[], symbol: string, companyShortName: string): NewsItem[] {
  const patterns = [companyShortName, symbol].filter((w) => w.length > 0).map(wholeWord);
  let best: { items: unknown[][]; score: number } | undefined;
  for (const group of findAll(blobs, (a) => a.filter(isNewsItem).length >= 3)) {
    const items = group.filter(isNewsItem);
    const score = items.filter((it) => patterns.some((p) => p.test(it[1] as string))).length;
    if (!best || score > best.score || (score === best.score && items.length > best.items.length)) {
      best = { items, score };
    }
  }
  if (!best || best.score === 0) return [];

  const byUrl = new Map<string, NewsItem>();
  for (const a of best.items) {
    const url = a[0] as string;
    if (!byUrl.has(url)) {
      byUrl.set(url, { url, title: a[1] as string, source: a[2] as string, publishedAt: a[4] as number });
    }
  }
  return [...byUrl.values()].sort((x, y) => y.publishedAt - x.publishedAt).slice(0, MAX_NEWS);
}

const DEFAULT_BASE = "/finance/_/FinHubUi";

/** Pulls the batchexecute tokens (`FdrFJe`, `cfb2h`, `Im6cmf`) out of the page. Needs both sid and bl. */
export function extractSession(html: string): Session | undefined {
  const sid = /"FdrFJe":"([^"]+)"/.exec(html)?.[1];
  const bl = /"cfb2h":"([^"]+)"/.exec(html)?.[1];
  if (!sid || !bl) return undefined;
  return { sid, bl, base: /"Im6cmf":"([^"]+)"/.exec(html)?.[1] ?? DEFAULT_BASE };
}

function parseUnsafe(html: string, symbol: string, exchange: string): ParseResult {
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
  const description = isStr(profile?.[2]) ? (profile[2] as string) : undefined;

  const candles = findChartCandles(blobs, symbol, exchange);

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
    description,
    stats,
    intraday: candles.get(300) ?? [],
    daily: candles.get(86400) ?? [],
    news: findNews(blobs, symbol, isStr(profile?.[1]) ? (profile[1] as string) : (entry[2] as string).split(/\s+/)[0]),
    session: extractSession(html),
  };
  return { ok: true, quote };
}

/** Never throws: any unexpected failure is reported as a layout problem. */
export function parseGoogleFinance(html: string, symbol: string, exchange: string): ParseResult {
  try {
    return parseUnsafe(html, symbol, exchange);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, kind: "layout", reason: `Unexpected error while parsing the Google Finance page: ${message}` };
  }
}
