import { useEffect, useState } from "react";
import { getFresh, putFresh } from "./cache";
import { raycastKV } from "./kv";
import { fetchRange, type RangeId, type RangeResult } from "./ranges";
import type { Candle, Quote } from "./types";

const CHART_TTL_MS = 5 * 60_000;

export interface ChartState {
  candles: Candle[] | undefined;
  loading: boolean;
  error: string | undefined;
}

const isCandles = (x: unknown): x is Candle[] => Array.isArray(x) && x.length > 0;

/**
 * Candles for the chosen range. 1D and 1M come straight from the quote; the others are fetched
 * (and cached for 5 minutes). In-flight fetches are aborted when the quote or range changes.
 */
export function useChart(quote: Quote | undefined, range: RangeId): ChartState {
  const symbol = quote?.symbol;
  const exchange = quote?.exchange;
  const session = quote?.session;
  const fetched = range !== "1D" && range !== "1M";
  const key = `${exchange}:${symbol}:${range}`;
  const [done, setDone] = useState<{ key: string; result: RangeResult }>();

  useEffect(() => {
    if (!fetched || !symbol || !exchange || !session) return;
    const abort = new AbortController();
    (async () => {
      const cacheKey = `chart:v1:${exchange}:${symbol}:${range}`;
      try {
        const stored = await getFresh<Candle[]>(raycastKV, cacheKey, CHART_TTL_MS);
        const result: RangeResult = isCandles(stored)
          ? { ok: true, candles: stored }
          : await fetchRange(symbol, exchange, range, session, { signal: abort.signal });
        if (!isCandles(stored) && result.ok) {
          try {
            await putFresh(raycastKV, cacheKey, result.candles);
          } catch {
            // Caching is best-effort.
          }
        }
        if (!abort.signal.aborted) setDone({ key, result });
      } catch (error) {
        if (abort.signal.aborted) return;
        const reason = error instanceof Error ? error.message : String(error);
        setDone({ key, result: { ok: false, kind: "network", reason } });
      }
    })();
    return () => abort.abort();
  }, [fetched, symbol, exchange, session?.sid, session?.bl, session?.base, range]);

  if (!quote) return { candles: undefined, loading: false, error: undefined };
  if (range === "1D") return { candles: quote.intraday, loading: false, error: undefined };
  if (range === "1M") return { candles: quote.daily, loading: false, error: undefined };
  if (!session) return { candles: undefined, loading: false, error: "Chart ranges unavailable for this quote." };
  if (!done || done.key !== key) return { candles: undefined, loading: true, error: undefined };
  return done.result.ok
    ? { candles: done.result.candles, loading: false, error: undefined }
    : { candles: undefined, loading: false, error: done.result.reason };
}
