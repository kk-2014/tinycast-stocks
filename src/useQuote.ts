import { useEffect, useRef, useState } from "react";
import { getFresh, putFresh } from "./cache";
import { fetchQuote } from "./google";
import { raycastKV } from "./kv";
import type { ParseResult } from "./types";

const QUOTE_TTL_MS = 60_000;
const SELECTION_DEBOUNCE_MS = 250;

export type QuoteState =
  | { symbol: string; exchange: string; status: "loading" }
  | { symbol: string; exchange: string; status: "done"; result: ParseResult };

/** Fetches the quote for `symbol` once the selection settles. Cancels in-flight work on change. */
export function useQuote(symbol: string | undefined, exchange: string = "", refreshKey = 0): QuoteState | undefined {
  const [state, setState] = useState<QuoteState>();
  const handledRef = useRef(refreshKey);

  useEffect(() => {
    if (!symbol) {
      setState(undefined);
      return;
    }
    // "Refresh Quote" bypasses the cache once per click, not for every later selection.
    const force = refreshKey !== handledRef.current;
    handledRef.current = refreshKey;
    const abort = new AbortController();
    setState({ symbol, exchange, status: "loading" });

    const timer = setTimeout(async () => {
      try {
        const cacheKey = `quote:v2:${exchange}:${symbol}`;
        const stored = force ? undefined : await getFresh<ParseResult>(raycastKV, cacheKey, QUOTE_TTL_MS);
        const cached = typeof stored === "object" && stored !== null && typeof stored.ok === "boolean" ? stored : undefined;
        const result = cached ?? (await fetchQuote(symbol, { hints: raycastKV, signal: abort.signal, ...(exchange ? { exchange } : {}) }));
        if (!cached && (result.ok || result.kind === "not-found")) {
          try {
            await putFresh(raycastKV, cacheKey, result);
          } catch {
            // Caching is best-effort; never let it turn a good quote into an error.
          }
        }
        if (!abort.signal.aborted) setState({ symbol, exchange, status: "done", result });
      } catch (error) {
        if (abort.signal.aborted) return;
        const reason = error instanceof Error ? error.message : String(error);
        setState({ symbol, exchange, status: "done", result: { ok: false, kind: "network", reason } });
      }
    }, SELECTION_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [symbol, exchange, refreshKey]);

  return state;
}
