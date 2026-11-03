import { describe, expect, it } from "vitest";
import { parseFavs, toggleFav } from "../src/favorites";

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
