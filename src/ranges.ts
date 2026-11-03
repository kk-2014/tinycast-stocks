import { defaultFetcher, UA, type Fetcher } from "./http";
import { parseBatchExecute } from "./parse";
import type { Candle, FailureKind, Session } from "./types";

export type RangeId = "1D" | "5D" | "1M" | "6M" | "YTD" | "1Y" | "5Y" | "MAX";

/** `code` is Google's c2u4wc range code; 1D and 1M have none because the quote page already carries them. */
export const RANGES: { id: RangeId; label: string; code?: number }[] = [
  { id: "1D", label: "1 Day" },
  { id: "5D", label: "5 Days", code: 2 },
  { id: "1M", label: "1 Month" },
  { id: "6M", label: "6 Months", code: 4 },
  { id: "YTD", label: "Year to Date", code: 5 },
  { id: "1Y", label: "1 Year", code: 6 },
  { id: "5Y", label: "5 Years", code: 7 },
  { id: "MAX", label: "Max", code: 8 },
];

export type RangeResult = { ok: true; candles: Candle[] } | { ok: false; kind: FailureKind; reason: string };

export interface FetchRangeOptions {
  fetcher?: Fetcher;
  signal?: AbortSignal;
}

/**
 * Fetch candles for a range via Google's internal batchexecute RPC (undocumented; may change).
 * Network errors (including AbortError) propagate to the caller.
 */
export async function fetchRange(
  symbol: string,
  exchange: string,
  range: RangeId,
  session: Session,
  options: FetchRangeOptions = {},
): Promise<RangeResult> {
  const code = RANGES.find((r) => r.id === range)?.code;
  if (code === undefined) {
    return { ok: false, kind: "layout", reason: `The ${range} range is served from the quote page, not fetched.` };
  }
  const fetcher = options.fetcher ?? defaultFetcher;
  const request = JSON.stringify([[[null, [symbol, exchange]]], code, null, null, null, null, null, 1]);
  const fReq = JSON.stringify([[["c2u4wc", request, null, "generic"]]]);
  const params = new URLSearchParams({
    rpcids: "c2u4wc",
    "source-path": `/finance/quote/${symbol}:${exchange}`,
    "f.sid": session.sid,
    bl: session.bl,
    hl: "en",
    rt: "c",
  });
  const res = await fetcher(`https://www.google.com${session.base}/data/batchexecute?${params}`, {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams({ "f.req": fReq }).toString(),
    signal: options.signal,
  });
  if (res.status === 403 || res.status === 429) {
    return {
      ok: false,
      kind: "blocked",
      reason: `Google Finance blocked the request (HTTP ${res.status}). Try again in a few minutes.`,
    };
  }
  if (!res.ok) return { ok: false, kind: "network", reason: `Google Finance returned HTTP ${res.status}` };
  return parseBatchExecute(await res.text(), symbol, exchange);
}
