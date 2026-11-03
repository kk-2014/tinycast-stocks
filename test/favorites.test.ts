import { describe, expect, it } from "vitest";
import { favKey, parseFavs, toggleFav } from "../src/favorites";

const aapl = { symbol: "AAPL", name: "Apple Inc." };
const msft = { symbol: "MSFT", name: "Microsoft" };

describe("toggleFav", () => {
  it("adds a missing favorite at the end", () => {
    expect(toggleFav([aapl], msft)).toEqual([aapl, msft]);
  });
  it("removes an existing favorite", () => {
    expect(toggleFav([aapl, msft], aapl)).toEqual([msft]);
  });
});

describe("parseFavs", () => {
  it("parses a valid list", () => {
    expect(parseFavs(JSON.stringify([aapl]))).toEqual([aapl]);
  });
  it("returns [] for undefined, junk, or the wrong shape", () => {
    expect(parseFavs(undefined)).toEqual([]);
    expect(parseFavs("{nope")).toEqual([]);
    expect(parseFavs(JSON.stringify({ a: 1 }))).toEqual([]);
    expect(parseFavs(JSON.stringify([{ symbol: 1 }, aapl]))).toEqual([aapl]);
  });
});

describe("exchange-aware favorites", () => {
  const nse = { symbol: "RELIANCE", name: "Reliance", exchange: "NSE" };
  const bom = { symbol: "RELIANCE", name: "Reliance", exchange: "BOM" };

  it("treats the same symbol on different exchanges as distinct", () => {
    expect(toggleFav([nse], bom)).toEqual([nse, bom]);
    expect(toggleFav([nse, bom], nse)).toEqual([bom]);
  });
  it("matches an exchange-less favourite only with another exchange-less one", () => {
    expect(toggleFav([aapl], { ...aapl, exchange: "" })).toEqual([]);
    expect(toggleFav([aapl], { ...aapl, exchange: "NSE" })).toEqual([aapl, { ...aapl, exchange: "NSE" }]);
  });
  it("still parses old-format favourites and round-trips the exchange", () => {
    expect(parseFavs(JSON.stringify([aapl]))).toEqual([aapl]);
    expect(parseFavs(JSON.stringify([nse, aapl]))).toEqual([nse, aapl]);
  });
  it("builds a key from exchange and symbol", () => {
    expect(favKey(nse)).toBe("NSE:RELIANCE");
    expect(favKey(aapl)).toBe(":AAPL");
  });
});
