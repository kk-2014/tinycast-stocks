export interface Candle {
  open: number;
  close: number;
  high: number;
  low: number;
  /** ISO-8601 with offset, e.g. 2026-11-03T09:30:00-05:00 */
  time: string;
  volume: number;
}

export interface NewsItem {
  url: string;
  title: string;
  source: string;
  /** Unix epoch seconds */
  publishedAt: number;
}

export interface Stats {
  open?: number;
  high?: number;
  low?: number;
  marketCap?: number;
  volume?: number;
  avgVolume?: number;
  yearHigh?: number;
  yearLow?: number;
  peRatio?: number;
  eps?: number;
  beta?: number;
  sharesOutstanding?: number;
  employees?: number;
  /** Percent, e.g. 0.33 means 0.33% */
  dividendYield?: number;
}

/** Regular-session window, Unix epoch seconds. */
export interface MarketHours {
  open: number;
  close: number;
}

export interface Analyst {
  targetLow: number;
  targetHigh: number;
  targetAvg: number;
  count: number;
  /** Prettified, e.g. "Strong Buy" */
  rating: string;
  buy: number;
  sell: number;
  hold: number;
}

export interface Peer {
  symbol: string;
  exchange: string;
  name: string;
  currency: string;
  price: number;
  change: number;
  changePercent: number;
}

/** Tokens from the quote page that Google's batchexecute RPC needs. */
export interface Session {
  sid: string;
  bl: string;
  base: string;
}

export interface Quote {
  symbol: string;
  exchange: string;
  name: string;
  currency: string;
  price: number;
  change: number;
  changePercent: number;
  previousClose: number;
  /** Unix epoch seconds of the quote, if present */
  updatedAt?: number;
  description?: string;
  stats: Stats;
  /** 5-minute candles for the current session (may be empty) */
  intraday: Candle[];
  /** Daily candles, about one month (may be empty) */
  daily: Candle[];
  news: NewsItem[];
  marketHours?: MarketHours;
  analyst?: Analyst;
  /** Related tickers (may be empty) */
  peers: Peer[];
  /** Present when the page carried the RPC tokens needed for longer chart ranges */
  session?: Session;
}

export type FailureKind = "layout" | "not-found" | "blocked" | "network";

export type ParseResult =
  | { ok: true; quote: Quote }
  | { ok: false; kind: FailureKind; reason: string };
