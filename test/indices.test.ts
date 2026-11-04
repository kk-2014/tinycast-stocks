import { describe, expect, it } from "vitest";
import { INDICES, searchIndices } from "../src/indices";

const symbols = (q: string) => searchIndices(q).map((h) => h.symbol);

describe("searchIndices", () => {
  it("returns nothing for a blank query", () => {
    expect(searchIndices("  ")).toEqual([]);
  });

  it("finds Indian indices by common names and aliases", () => {
    expect(symbols("nifty")).toEqual(expect.arrayContaining(["NIFTY_50", "NIFTY_BANK"]));
    expect(symbols("banknifty")[0]).toBe("NIFTY_BANK");
    expect(symbols("bank nifty")[0]).toBe("NIFTY_BANK");
    expect(symbols("sensex")).toEqual(["SENSEX"]);
  });

  it("finds US indices", () => {
    expect(symbols("nasdaq")).toEqual(expect.arrayContaining([".IXIC", "NDX"]));
    expect(symbols("s&p")).toContain(".INX");
    expect(symbols("spx")[0]).toBe(".INX");
    expect(symbols("dow")).toContain(".DJI");
  });

  it("is case-insensitive and tags hits as indices with a Google exchange code", () => {
    const hit = searchIndices("NiFtY 50")[0];
    expect(hit).toEqual({ symbol: "NIFTY_50", exchange: "INDEXNSE", name: "Nifty 50", type: "Index" });
  });

  it("returns nothing for unrelated queries", () => {
    expect(searchIndices("reliance")).toEqual([]);
  });

  it("has unique symbol/exchange pairs", () => {
    const keys = INDICES.map((i) => `${i.exchange}:${i.symbol}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
