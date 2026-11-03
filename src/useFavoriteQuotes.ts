import { useEffect, useRef, useState } from "react";
import { mapWithConcurrency } from "./batch";
import { getFresh, putFresh } from "./cache";
import { favKey, type Fav } from "./favorites";
import { fetchQuote } from "./google";
import { raycastKV } from "./kv";
import type { ParseResult } from "./types";

const QUOTE_TTL_MS = 60_000;
const CONCURRENCY = 3;

/**
 * Live quotes for the favorites list, keyed by `favKey`. Fetches at most 3 at a time, shares the
 * detail view's cache, and fills the map in progressively. Pass `[]` to fetch nothing.
 */
export function useFavoriteQuotes(favs: Fav[], refreshKey: number): Map<string, ParseResult> {
  const [quotes, setQuotes] = useState<Map<string, ParseResult>>(new Map());
  const handledRef = useRef(refreshKey);
  const depsKey = favs.map(favKey).join("|");

  useEffect(() => {
    const force = refreshKey !== handledRef.current;
    handledRef.current = refreshKey;
    if (favs.length === 0) {
      setQuotes((prev) => (prev.size === 0 ? prev : new Map()));
      return;
    }
    const abort = new AbortController();
    const set = (key: string, result: ParseResult) => {
      if (!abort.signal.aborted) setQuotes((prev) => new Map(prev).set(key, result));
    };

    mapWithConcurrency(favs, CONCURRENCY, async (fav) => {
      if (abort.signal.aborted) return;
      const key = favKey(fav);
      try {
        const cacheKey = `quote:v2:${fav.exchange ?? ""}:${fav.symbol}`;
        const stored = force ? undefined : await getFresh<ParseResult>(raycastKV, cacheKey, QUOTE_TTL_MS);
        const cached = typeof stored === "object" && stored !== null && typeof stored.ok === "boolean" ? stored : undefined;
        const result =
          cached ??
          (await fetchQuote(fav.symbol, {
            hints: raycastKV,
            signal: abort.signal,
            ...(fav.exchange ? { exchange: fav.exchange } : {}),
          }));
        if (!cached && (result.ok || result.kind === "not-found")) {
          try {
            await putFresh(raycastKV, cacheKey, result);
          } catch {
            // Caching is best-effort; never let it turn a good quote into an error.
          }
        }
        set(key, result);
      } catch (error) {
        if (abort.signal.aborted) return;
        const reason = error instanceof Error ? error.message : String(error);
        set(key, { ok: false, kind: "network", reason });
      }
    }).catch(() => {
      // Each item handles its own errors; nothing should reach here.
    });

    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depsKey, refreshKey]);

  return quotes;
}
