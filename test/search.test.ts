import { describe, expect, it } from "vitest";
import type { FetchResponse, Fetcher } from "../src/http";
import { searchStocks } from "../src/search";

const json = (body: unknown, status = 200): FetchResponse => ({
  ok: status < 400,
  status,
  url: "https://stockanalysis.com/api/search",
  text: async () => JSON.stringify(body),
});

describe("searchStocks", () => {
  it("returns an empty list for a blank query without calling the network", async () => {
    let called = false;
    const fetcher: Fetcher = async () => ((called = true), json({}));
    expect(await searchStocks("   ", { fetcher })).toEqual([]);
    expect(called).toBe(false);
  });

  it("keeps stocks and ETFs, drops other types and slash symbols, caps at 8", async () => {
    const data = [
      { s: "AAPL", n: "Apple Inc.", t: "s" },
      { s: "SPY", n: "SPDR S&P 500", t: "e" },
      { s: "BTC/USD", n: "Bitcoin", t: "s" },
      { s: "XYZ", n: "Index thing", t: "i" },
      ...Array.from({ length: 12 }, (_, i) => ({ s: `T${i}`, n: `Name ${i}`, t: "s" })),
    ];
    const fetcher: Fetcher = async () => json({ data });
    const hits = await searchStocks("a", { fetcher });
    expect(hits[0]).toEqual({ symbol: "AAPL", name: "Apple Inc.", type: "Stock" });
    expect(hits[1]).toEqual({ symbol: "SPY", name: "SPDR S&P 500", type: "ETF" });
    expect(hits.map((h) => h.symbol)).not.toContain("BTC/USD");
    expect(hits.map((h) => h.symbol)).not.toContain("XYZ");
    expect(hits.length).toBe(8);
  });

  it("throws a readable error on HTTP failure", async () => {
    const fetcher: Fetcher = async () => json({}, 503);
    await expect(searchStocks("apple", { fetcher })).rejects.toThrow("Search failed (HTTP 503)");
  });

  it("returns an empty list when the payload has no data array", async () => {
    const fetcher: Fetcher = async () => json({ nope: true });
    expect(await searchStocks("apple", { fetcher })).toEqual([]);
  });

  it("throws a readable error when the body is not JSON", async () => {
    const fetcher: Fetcher = async () => ({ ok: true, status: 200, text: async () => "<html>oops</html>" });
    await expect(searchStocks("apple", { fetcher })).rejects.toThrow("Search returned an unexpected response");
  });

  it("de-duplicates hits by symbol, keeping the first", async () => {
    const data = [
      { s: "AAPL", n: "Apple Inc.", t: "s" },
      { s: "MSFT", n: "Microsoft", t: "s" },
      { s: "AAPL", n: "Apple Duplicate", t: "s" },
    ];
    const fetcher: Fetcher = async () => json({ data });
    expect(await searchStocks("a", { fetcher })).toEqual([
      { symbol: "AAPL", name: "Apple Inc.", type: "Stock" },
      { symbol: "MSFT", name: "Microsoft", type: "Stock" },
    ]);
  });

  it("rejects when the fetcher throws an AbortError", async () => {
    const fetcher: Fetcher = async () => {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    };
    await expect(searchStocks("apple", { fetcher })).rejects.toThrow();
  });
});
