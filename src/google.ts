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
