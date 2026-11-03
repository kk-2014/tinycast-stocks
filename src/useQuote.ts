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
