import { describe, expect, it } from "vitest";
import { insightsMarkdown } from "../src/insights";
import type { Quote } from "../src/types";

const base: Quote = {
  symbol: "AAPL",
  exchange: "NASDAQ",
  name: "Apple Inc",
  currency: "USD",
  price: 300,
  change: 0,
  changePercent: 0,
  previousClose: 300,
  stats: {},
  intraday: [],
  daily: [],
  news: [],
  peers: [],
};

describe("insightsMarkdown", () => {
  it("is empty when there is nothing to show", () => {
    expect(insightsMarkdown(base)).toBe("");
  });

  it("renders analysts, price target and peers", () => {
    const md = insightsMarkdown({
      ...base,
      analyst: { targetLow: 250, targetHigh: 400, targetAvg: 330, count: 29, rating: "Buy", buy: 15, sell: 5, hold: 9 },
      peers: [
        { symbol: "NVDA", exchange: "NASDAQ", name: "NVIDIA Corp", currency: "USD", price: 208.0301, change: 5.97, changePercent: 2.9546 },
        { symbol: "TSLA", exchange: "NASDAQ", name: "Tesla", currency: "USD", price: 400, change: -4, changePercent: -1 },
      ],
    });
    expect(md).toContain("### Insights");
    expect(md).toContain("**Analysts:** Buy · 29 analysts (15 Buy / 9 Hold / 5 Sell)");
    expect(md).toContain("**Price target:** $330.00 (low $250.00 – high $400.00), +10.00% vs current price");
    expect(md).toContain("**Peers:** NVDA $208.03 (+2.95%) · TSLA $400.00 (-1.00%)");
  });

  it("omits lines without data", () => {
    const md = insightsMarkdown({ ...base, peers: [{ symbol: "X", exchange: "E", name: "X", currency: "USD", price: 1, change: 0, changePercent: 0 }] });
    expect(md).toContain("**Peers:**");
    expect(md).not.toContain("Analysts");
  });
});
