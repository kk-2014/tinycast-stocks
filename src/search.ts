import { defaultFetcher, UA, type Fetcher } from "./http";

export interface SearchHit {
  symbol: string;
  name: string;
  type: "Stock" | "ETF";
}

const MAX_HITS = 8;

interface RawHit {
  s?: string;
  n?: string;
  t?: string;
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

  const body = JSON.parse(await res.text()) as { data?: RawHit[] };
  if (!Array.isArray(body.data)) return [];

  const hits: SearchHit[] = [];
  for (const raw of body.data) {
    if (!raw.s || !raw.n || raw.s.includes("/")) continue;
    if (raw.t !== "s" && raw.t !== "e") continue;
    hits.push({ symbol: raw.s, name: raw.n, type: raw.t === "e" ? "ETF" : "Stock" });
    if (hits.length >= MAX_HITS) break;
  }
  return hits;
}
