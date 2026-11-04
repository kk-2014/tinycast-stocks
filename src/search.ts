import { defaultFetcher, UA, type Fetcher } from "./http";

export interface SearchHit {
  symbol: string;
  /** "" for US listings (found later by probing), "NSE" or "BOM" for Indian ones, "INDEX…" for indices. */
  exchange: string;
  name: string;
  type: "Stock" | "ETF" | "Index";
}

const MAX_HITS = 10;

interface RawHit {
  s?: string;
  n?: string;
  t?: string;
  st?: string;
}

const INDIAN_PREFIXES: Record<string, string> = { nse: "NSE", bom: "BOM" };

function toHit(raw: RawHit): SearchHit | undefined {
  if (!raw.s || !raw.n) return undefined;
  if (raw.s.includes("/")) {
    const slash = raw.s.indexOf("/");
    const exchange = INDIAN_PREFIXES[raw.s.slice(0, slash).toLowerCase()];
    const symbol = raw.s.slice(slash + 1);
    if (!exchange || !symbol || raw.t !== "sy" || (raw.st !== "s" && raw.st !== "e")) return undefined;
    return { symbol, exchange, name: raw.n, type: raw.st === "e" ? "ETF" : "Stock" };
  }
  if (raw.t !== "s" && raw.t !== "e") return undefined;
  return { symbol: raw.s, exchange: "", name: raw.n, type: raw.t === "e" ? "ETF" : "Stock" };
}

export async function searchStocks(
  query: string,
  options: { fetcher?: Fetcher; signal?: AbortSignal } = {},
): Promise<SearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  const fetcher = options.fetcher ?? defaultFetcher;
  const res = await fetcher(`https://stockanalysis.com/api/search?q=${encodeURIComponent(q)}`, {
    headers: { "User-Agent": UA },
    signal: options.signal,
  });
  if (!res.ok) throw new Error(`Search failed (HTTP ${res.status})`);

  let body: { data?: RawHit[] };
  try {
    body = JSON.parse(await res.text()) as { data?: RawHit[] };
  } catch {
    throw new Error("Search returned an unexpected response");
  }
  if (!Array.isArray(body.data)) return [];

  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  for (const raw of body.data) {
    const hit = toHit(raw);
    if (!hit) continue;
    const key = `${hit.exchange}:${hit.symbol}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push(hit);
    if (hits.length >= MAX_HITS) break;
  }
  return hits;
}
