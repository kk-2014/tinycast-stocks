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
