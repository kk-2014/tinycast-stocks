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
    if (!raw.s || !raw.n || raw.s.includes("/")) continue;
    if (raw.t !== "s" && raw.t !== "e") continue;
    if (seen.has(raw.s)) continue;
    seen.add(raw.s);
    hits.push({ symbol: raw.s, name: raw.n, type: raw.t === "e" ? "ETF" : "Stock" });
    if (hits.length >= MAX_HITS) break;
  }
  return hits;
}
