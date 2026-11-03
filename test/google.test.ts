import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { KV } from "../src/cache";
import { fetchQuote, quoteUrl } from "../src/google";
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
});
