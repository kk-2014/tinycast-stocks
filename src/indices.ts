import type { SearchHit } from "./search";

interface IndexEntry {
  /** Google Finance symbol, e.g. NIFTY_50 or .INX. */
  symbol: string;
  /** Google Finance index venue code, e.g. INDEXNSE. */
  exchange: string;
  name: string;
  /** Extra lowercase search terms; spaces and punctuation are ignored when matching. */
  aliases: string[];
}

export const INDICES: IndexEntry[] = [
  { symbol: "NIFTY_50", exchange: "INDEXNSE", name: "Nifty 50", aliases: ["nifty", "nifty50", "nsei"] },
  { symbol: "NIFTY_BANK", exchange: "INDEXNSE", name: "Nifty Bank", aliases: ["nifty", "banknifty", "bank nifty", "nsebank"] },
  { symbol: "NIFTY_NEXT_50", exchange: "INDEXNSE", name: "Nifty Next 50", aliases: ["nifty", "junior nifty"] },
  { symbol: "NIFTY_MIDCAP_50", exchange: "INDEXNSE", name: "Nifty Midcap 50", aliases: ["nifty", "midcap"] },
  { symbol: "NIFTY_IT", exchange: "INDEXNSE", name: "Nifty IT", aliases: ["nifty", "niftyit"] },
  { symbol: "INDIA_VIX", exchange: "INDEXNSE", name: "India VIX", aliases: ["vix", "indiavix"] },
  { symbol: "SENSEX", exchange: "INDEXBOM", name: "BSE Sensex", aliases: ["sensex", "bse", "bse30"] },
  { symbol: ".INX", exchange: "INDEXSP", name: "S&P 500", aliases: ["spx", "sp500", "s&p", "snp"] },
  { symbol: ".DJI", exchange: "INDEXDJX", name: "Dow Jones Industrial Average", aliases: ["dow", "dji", "djia"] },
  { symbol: ".IXIC", exchange: "INDEXNASDAQ", name: "Nasdaq Composite", aliases: ["nasdaq", "ixic", "comp"] },
  { symbol: "NDX", exchange: "INDEXNASDAQ", name: "Nasdaq 100", aliases: ["nasdaq", "nasdaq100", "ndx", "qqq index"] },
  { symbol: "RUT", exchange: "INDEXRUSSELL", name: "Russell 2000", aliases: ["russell", "rut", "small cap"] },
  { symbol: "VIX", exchange: "INDEXCBOE", name: "CBOE Volatility Index", aliases: ["vix", "volatility"] },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9&]/g, "");

/** Local index lookup; the web search API does not return indices. Prefix matches rank first. */
export function searchIndices(query: string): SearchHit[] {
  const q = norm(query);
  if (!q) return [];
  const scored: { entry: IndexEntry; score: number }[] = [];
  for (const entry of INDICES) {
    const terms = [entry.name, entry.symbol, ...entry.aliases].map(norm);
    // Exact alias/symbol/name match, then prefix, then substring.
    const score = terms.includes(q) ? 0 : terms.some((t) => t.startsWith(q)) ? 1 : terms.some((t) => t.includes(q)) ? 2 : -1;
    if (score >= 0) scored.push({ entry, score });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.map(({ entry }) => ({ symbol: entry.symbol, exchange: entry.exchange, name: entry.name, type: "Index" }));
}
