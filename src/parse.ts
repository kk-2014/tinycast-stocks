import { extractBlobs, walk } from "./blobs";
import type { ParseResult, Quote, Stats } from "./types";

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
    intraday: [],
    daily: [],
    news: [],
  };
  return { ok: true, quote };
}
