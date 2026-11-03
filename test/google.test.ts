import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { KV } from "../src/cache";
import { EXCHANGES, fetchQuote, googleFinanceSearchUrl, quoteUrl } from "../src/google";
import type { FetchResponse, Fetcher } from "../src/http";

const html = readFileSync(join(__dirname, "fixtures/AAPL-NASDAQ-2026-11-03.html"), "utf8");

const page = (body: string, status = 200, url = "https://www.google.com/finance/quote/x"): FetchResponse => ({
  ok: status >= 200 && status < 300,
  status,
  url,
  text: async () => body,
});

function memoryKV(): KV {
  const m = new Map<string, string>();
  return { get: async (k) => m.get(k), set: async (k, v) => void m.set(k, v) };
}

describe("quoteUrl", () => {
  it("builds the Google Finance URL", () => {
    expect(quoteUrl("AAPL", "NASDAQ")).toBe("https://www.google.com/finance/quote/AAPL:NASDAQ");
  });
});

describe("fetchQuote", () => {
  it("returns the quote on the first matching exchange", async () => {
    const calls: string[] = [];
    const fetcher: Fetcher = async (url) => {
      calls.push(url);
      return page(html);
    };
    const r = await fetchQuote("aapl", { fetcher });
    expect(r.ok).toBe(true);
    expect(calls).toEqual([quoteUrl("AAPL", "NASDAQ")]);
  });

  it("probes further exchanges when the first is a 404, then remembers the hint", async () => {
    const hints = memoryKV();
    const calls: string[] = [];
    const fetcher: Fetcher = async (url) => {
      calls.push(url);
      return url.endsWith(":NYSE") ? page(html.replaceAll("NASDAQ", "NYSE")) : page("", 404);
    };
    const r = await fetchQuote("AAPL", { fetcher, hints });
    expect(r.ok && r.quote.exchange).toBe("NYSE");
    expect(calls.length).toBe(2);
    expect(await hints.get("exchange:AAPL")).toBe("NYSE");

    calls.length = 0;
    await fetchQuote("AAPL", { fetcher, hints });
    expect(calls).toEqual([quoteUrl("AAPL", "NYSE")]);
  });

  it("stops immediately on HTTP 429 with a blocked failure", async () => {
    let n = 0;
    const fetcher: Fetcher = async () => (n++, page("", 429));
    const r = await fetchQuote("AAPL", { fetcher });
    expect(r).toMatchObject({ ok: false, kind: "blocked" });
    expect(n).toBe(1);
  });

  it("stops immediately on a consent redirect", async () => {
    const fetcher: Fetcher = async () => page("", 200, "https://consent.google.com/m?continue=x");
    expect(await fetchQuote("AAPL", { fetcher })).toMatchObject({ ok: false, kind: "blocked" });
  });

  it("stops on a layout failure instead of probing every exchange", async () => {
    let n = 0;
    const fetcher: Fetcher = async () => (n++, page("<html>changed</html>"));
    const r = await fetchQuote("AAPL", { fetcher });
    expect(r).toMatchObject({ ok: false, kind: "layout" });
    expect(n).toBe(1);
  });

  it("returns not-found when no exchange has the symbol", async () => {
    const fetcher: Fetcher = async () => page("", 404);
    expect(await fetchQuote("ZZZZZ", { fetcher })).toMatchObject({ ok: false, kind: "not-found" });
  });

  it("parses fine when the response has no url", async () => {
    const fetcher: Fetcher = async () => ({ ok: true, status: 200, text: async () => html });
    expect((await fetchQuote("AAPL", { fetcher })).ok).toBe(true);
  });

  it("still returns the quote when the hint write fails", async () => {
    const hints: KV = { get: async () => undefined, set: async () => { throw new Error("disk full"); } };
    const fetcher: Fetcher = async () => page(html);
    expect((await fetchQuote("AAPL", { fetcher, hints })).ok).toBe(true);
  });

  it("only probes US venues", () => {
    expect(EXCHANGES).toEqual(["NASDAQ", "NYSE", "NYSEARCA", "NYSEAMERICAN", "BATS", "MUTF"]);
  });

  it("reports a network failure when every probe returns 503", async () => {
    const fetcher: Fetcher = async () => page("", 503);
    const r = await fetchQuote("AAPL", { fetcher });
    expect(r).toMatchObject({ ok: false, kind: "network" });
    expect(!r.ok && r.reason).toContain("HTTP 503");
  });

  it("reports not-found when every probe returns 404", async () => {
    const fetcher: Fetcher = async () => page("", 404);
    expect(await fetchQuote("AAPL", { fetcher })).toMatchObject({ ok: false, kind: "not-found" });
  });

  it("reports not-found when a 404 was seen even if later probes return 503", async () => {
    let n = 0;
    const fetcher: Fetcher = async () => page("", n++ === 0 ? 404 : 503);
    expect(await fetchQuote("AAPL", { fetcher })).toMatchObject({ ok: false, kind: "not-found" });
  });

  it("stops immediately on HTTP 403 with a blocked failure", async () => {
    let n = 0;
    const fetcher: Fetcher = async () => (n++, page("", 403));
    expect(await fetchQuote("AAPL", { fetcher })).toMatchObject({ ok: false, kind: "blocked" });
    expect(n).toBe(1);
  });

  it("requests the hinted exchange first and never twice", async () => {
    const hints = memoryKV();
    await hints.set("exchange:AAPL", "NYSE");
    const calls: string[] = [];
    const fetcher: Fetcher = async (url) => (calls.push(url), page("", 404));
    await fetchQuote("AAPL", { fetcher, hints });
    expect(calls[0]).toBe(quoteUrl("AAPL", "NYSE"));
    expect([...calls].sort()).toEqual(EXCHANGES.map((e) => quoteUrl("AAPL", e)).sort());
    expect(new Set(calls).size).toBe(calls.length);
  });

  it("rejects when the fetcher throws an AbortError", async () => {
    const fetcher: Fetcher = async () => {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    };
    await expect(fetchQuote("AAPL", { fetcher })).rejects.toThrow();
  });
});

describe("googleFinanceSearchUrl", () => {
  it("builds an encoded search URL", () => {
    expect(googleFinanceSearchUrl("BRK.B")).toBe("https://www.google.com/finance/?q=BRK.B");
    expect(googleFinanceSearchUrl("A B&C")).toBe("https://www.google.com/finance/?q=A%20B%26C");
  });
});
