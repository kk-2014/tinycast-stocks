import { readFileSync } from "node:fs";
import { join } from "node:path";
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

  it("keeps stocks and ETFs, drops other types and foreign slash symbols, caps at 10", async () => {
    const data = [
      { s: "AAPL", n: "Apple Inc.", t: "s" },
      { s: "SPY", n: "SPDR S&P 500", t: "e" },
      { s: "BTC/USD", n: "Bitcoin", t: "s" },
      { s: "XYZ", n: "Index thing", t: "i" },
      ...Array.from({ length: 12 }, (_, i) => ({ s: `T${i}`, n: `Name ${i}`, t: "s" })),
    ];
    const fetcher: Fetcher = async () => json({ data });
    const hits = await searchStocks("a", { fetcher });
    expect(hits[0]).toEqual({ symbol: "AAPL", exchange: "", name: "Apple Inc.", type: "Stock" });
    expect(hits[1]).toEqual({ symbol: "SPY", exchange: "", name: "SPDR S&P 500", type: "ETF" });
    expect(hits.map((h) => h.symbol)).not.toContain("BTC/USD");
    expect(hits.map((h) => h.symbol)).not.toContain("XYZ");
    expect(hits.length).toBe(10);
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
      { symbol: "AAPL", exchange: "", name: "Apple Inc.", type: "Stock" },
      { symbol: "MSFT", exchange: "", name: "Microsoft", type: "Stock" },
    ]);
  });

  it("rejects when the fetcher throws an AbortError", async () => {
    const fetcher: Fetcher = async () => {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    };
    await expect(searchStocks("apple", { fetcher })).rejects.toThrow();
  });

  describe("Indian listings", () => {
    const fixture = JSON.parse(
      readFileSync(join(__dirname, "fixtures/stockanalysis-search-reliance.json"), "utf8"),
    ) as unknown;
    const fetcher: Fetcher = async () => json(fixture);

    it("returns NSE and BSE listings with their exchange", async () => {
      const hits = await searchStocks("reliance", { fetcher });
      expect(hits).toContainEqual({
        symbol: "RELIANCE",
        exchange: "NSE",
        name: "Reliance Industries Limited",
        type: "Stock",
      });
      expect(hits).toContainEqual({
        symbol: "500325",
        exchange: "BOM",
        name: "Reliance Industries Limited",
        type: "Stock",
      });
      expect(hits).toContainEqual({ symbol: "RS", exchange: "", name: "Reliance, Inc.", type: "Stock" });
      expect(hits.find((h) => h.symbol === "GOLDBEES")).toMatchObject({ exchange: "NSE", type: "ETF" });
    });

    it("drops foreign venues and caps at 10, preserving order", async () => {
      const hits = await searchStocks("reliance", { fetcher });
      const symbols = hits.map((h) => h.symbol);
      for (const foreign of ["RWC", "RLLWF", "FSRL", "RELIANCINS", "RELI", "6027"]) {
        expect(symbols).not.toContain(foreign);
      }
      expect(hits.length).toBeLessThanOrEqual(10);
      expect(symbols.indexOf("RELIANCE")).toBeLessThan(symbols.indexOf("500325"));
    });

    it("keeps the same ticker on different exchanges as separate hits", async () => {
      const data = [
        { s: "nse/ABC", n: "Abc NSE", t: "sy", st: "s" },
        { s: "BOM/ABC", n: "Abc BSE", t: "sy", st: "s" },
        { s: "nse/ABC", n: "Abc again", t: "sy", st: "s" },
        { s: "nse/XYZ", n: "Index", t: "sy", st: "i" },
        { s: "nse/QQQ", n: "Wrong t", t: "s", st: "s" },
      ];
      const hits = await searchStocks("abc", { fetcher: async () => json({ data }) });
      expect(hits).toEqual([
        { symbol: "ABC", exchange: "NSE", name: "Abc NSE", type: "Stock" },
        { symbol: "ABC", exchange: "BOM", name: "Abc BSE", type: "Stock" },
      ]);
    });
  });
});
