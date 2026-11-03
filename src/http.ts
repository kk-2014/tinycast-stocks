export const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface FetchResponse {
  ok: boolean;
  status: number;
  url?: string;
  text(): Promise<string>;
}

export type Fetcher = (
  url: string,
  init: { headers: Record<string, string>; signal?: AbortSignal; method?: string; body?: string },
) => Promise<FetchResponse>;

export const defaultFetcher: Fetcher = (url, init) => fetch(url, init);
