import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractSession, parseGoogleFinance } from "../src/parse";

const html = readFileSync(join(__dirname, "fixtures/AAPL-NASDAQ-2026-11-03.html"), "utf8");

function parsed() {
  const r = parseGoogleFinance(html, "AAPL", "NASDAQ");
  if (!r.ok) throw new Error(`expected ok, got ${r.kind}: ${r.reason}`);
  return r.quote;
}

describe("parseGoogleFinance: quote", () => {
  it("extracts identity and headline quote", () => {
    const q = parsed();
    expect(q.symbol).toBe("AAPL");
    expect(q.exchange).toBe("NASDAQ");
    expect(q.name).toBe("Apple Inc");
    expect(q.currency).toBe("USD");
    expect(q.price).toBeCloseTo(331.775, 3);
    expect(q.change).toBeCloseTo(-6.545, 3);
    expect(q.changePercent).toBeCloseTo(-1.9346, 3);
    expect(q.previousClose).toBeCloseTo(338.32, 2);
    expect(q.updatedAt).toBe(1793731545);
  });

  it("is internally consistent: price - previousClose == change", () => {
    const q = parsed();
    expect(q.price - q.previousClose).toBeCloseTo(q.change, 3);
  });
});

describe("parseGoogleFinance: failures", () => {
  it("reports a layout failure when there are no data blobs", () => {
    const r = parseGoogleFinance("<html>consent wall</html>", "AAPL", "NASDAQ");
    expect(r).toMatchObject({ ok: false, kind: "layout" });
  });

  it("reports not-found when the page is for a different symbol", () => {
    const r = parseGoogleFinance(html, "ZZZZ", "NASDAQ");
    expect(r).toMatchObject({ ok: false, kind: "not-found" });
  });
});

describe("parseGoogleFinance: stats", () => {
  it("extracts trading data and profile stats", () => {
    const s = parsed().stats;
    expect(s.open).toBeCloseTo(325.58, 2);
    expect(s.high).toBeCloseTo(334.5, 2);
    expect(s.low).toBeCloseTo(325.33, 2);
    expect(s.marketCap).toBeGreaterThan(4.8e12);
    expect(s.volume).toBe(36283672);
    expect(s.yearHigh).toBeCloseTo(351.73, 2);
    expect(s.yearLow).toBeCloseTo(243.42, 2);
    expect(s.peRatio).toBeCloseTo(36.95, 1);
    expect(s.avgVolume).toBe(39698332);
    expect(s.eps).toBeCloseTo(8.98, 1);
    expect(s.beta).toBeCloseTo(1.07, 1);
    expect(s.sharesOutstanding).toBe(14594180000);
    expect(s.employees).toBe(166000);
  });

  it("extracts the company description", () => {
    expect(parsed().description).toMatch(/^Apple Inc\./);
  });
});

describe("parseGoogleFinance: candles", () => {
  it("extracts 5-minute intraday candles", () => {
    const q = parsed();
    expect(q.intraday.length).toBe(52);
    expect(q.intraday[0]).toEqual({
      open: 325.58,
      close: 326.04,
      high: 326.23,
      low: 325.33,
      time: "2026-11-03T09:30:00-05:00",
      volume: 8519,
    });
  });

  it("extracts daily candles ending at the previous close", () => {
    const q = parsed();
    expect(q.daily.length).toBe(21);
    expect(q.daily[q.daily.length - 1].close).toBeCloseTo(q.previousClose, 2);
  });
});

describe("parseGoogleFinance: news", () => {
  it("extracts de-duplicated news, newest first", () => {
    const news = parsed().news;
    expect(news.length).toBe(18);
    for (const n of news) expect(n.title).not.toMatch(/Sensex|Nifty|\bNSE\b/);
    for (const n of news) {
      expect(n.url).toMatch(/^https?:\/\//);
      expect(n.title.length).toBeGreaterThan(5);
      expect(n.source.length).toBeGreaterThan(0);
      expect(n.publishedAt).toBeGreaterThan(1_700_000_000);
    }
    expect(new Set(news.map((n) => n.url)).size).toBe(news.length);
    const times = news.map((n) => n.publishedAt);
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });
});

const blob = (x: unknown) => `AF_initDataCallback({key: 'ds:0', hash: '1', data:${JSON.stringify(x)}, sideChannel: {}});`;
const zedEntry = ["/m/x", ["ZZZ", "NASDAQ"], "Zed Corp", 0, "USD", [10, 1, 10, 2, 2, 2], null, 9];

describe("parseGoogleFinance: scoping and robustness", () => {
  it("returns no news when no group mentions the company", () => {
    const group = [1, 2, 3].map((i) => [`https://x.test/${i}`, `Sensex rallies ${i}`, "Src", null, 1_800_000_000 + i]);
    const page = blob(zedEntry) + blob(group);
    const r = parseGoogleFinance(page, "ZZZ", "NASDAQ");
    if (!r.ok) throw new Error(r.reason);
    expect(r.quote.news).toEqual([]);
  });

  it("never throws on garbled input", () => {
    const inputs = [
      "AF_initDataCallback({key: 'ds:0', hash: '1', data:[[[[",
      `AF_initDataCallback({key: 'ds:0', hash: '1', data:[1,2`,
      blob([null, null, [null]]),
      blob(null),
      "",
    ];
    for (const i of inputs) {
      const r = parseGoogleFinance(i, "AAPL", "NASDAQ");
      expect(r.ok).toBe(false);
    }
  });
});

describe("extractSession", () => {
  it("reads sid, bl and base from the quote page", () => {
    expect(extractSession(html)).toEqual({
      sid: "8801222583360154613",
      bl: "boq_finhub-uiserver_20261101.02_p0",
      base: "/finance/_/FinHubUi",
    });
  });

  it("returns undefined when the tokens are missing", () => {
    expect(extractSession("<html>nothing here</html>")).toBeUndefined();
    expect(extractSession('"FdrFJe":"123"')).toBeUndefined();
  });

  it("defaults base when only sid and bl are present", () => {
    expect(extractSession('"FdrFJe":"1","cfb2h":"b"')).toEqual({ sid: "1", bl: "b", base: "/finance/_/FinHubUi" });
  });

  it("is attached to the parsed quote", () => {
    expect(parsed().session).toEqual({
      sid: "8801222583360154613",
      bl: "boq_finhub-uiserver_20261101.02_p0",
      base: "/finance/_/FinHubUi",
    });
  });
});

const relHtml = readFileSync(join(__dirname, "fixtures/RELIANCE-NSE.html"), "utf8");
function parsedReliance() {
  const r = parseGoogleFinance(relHtml, "RELIANCE", "NSE");
  if (!r.ok) throw new Error(`expected ok, got ${r.kind}: ${r.reason}`);
  return r.quote;
}

describe("parseGoogleFinance: market hours", () => {
  it("converts the AAPL session window (09:30-16:00 at UTC-5) to epoch seconds", () => {
    expect(parsed().marketHours).toEqual({ open: 1793716200, close: 1793739600 });
  });

  it("converts the RELIANCE session window (09:15-15:30 IST)", () => {
    expect(parsedReliance().marketHours).toEqual({
      open: Date.UTC(2026, 10, 3, 9, 15) / 1000 - 19800,
      close: Date.UTC(2026, 10, 3, 15, 30) / 1000 - 19800,
    });
  });

  it("treats a null minute as zero", () => {
    const entry = [...zedEntry];
    entry[19] = [[1, [2026, 11, 3, 9, 30, null, null, [-18000]], [2026, 11, 3, 16, null, null, null, [-18000]]]];
    const r = parseGoogleFinance(blob(entry), "ZZZ", "NASDAQ");
    if (!r.ok) throw new Error(r.reason);
    expect(r.quote.marketHours).toEqual({ open: 1793716200, close: 1793739600 });
  });
});

describe("parseGoogleFinance: analyst consensus", () => {
  it("extracts AAPL targets, counts and rating (Sell/Hold order inferred)", () => {
    expect(parsed().analyst).toEqual({
      targetLow: 250,
      targetHigh: 400,
      targetAvg: 338.22,
      count: 29,
      rating: "Buy",
      buy: 15,
      sell: 5,
      hold: 9,
    });
  });

  it("prettifies RELIANCE's rating", () => {
    const a = parsedReliance().analyst;
    expect(a).toMatchObject({ rating: "Strong Buy", buy: 4, sell: 0, hold: 0, targetAvg: 1688.75, count: 4 });
  });
});

describe("parseGoogleFinance: peers", () => {
  it("finds the AAPL peer group", () => {
    const peers = parsed().peers;
    expect(peers.map((p) => `${p.symbol}:${p.exchange}`)).toEqual([
      "NVDA:NASDAQ",
      "AMZN:NASDAQ",
      "MSFT:NASDAQ",
      "TSLA:NASDAQ",
    ]);
    expect(peers[0]).toMatchObject({ name: "NVIDIA Corp", currency: "USD" });
    expect(peers[0].price).toBeCloseTo(208.0301, 3);
    expect(peers[0].change).toBeCloseTo(5.970108, 3);
    expect(peers[0].changePercent).toBeCloseTo(2.9546216, 3);
  });

  it("finds the RELIANCE peer group", () => {
    expect(parsedReliance().peers.map((p) => `${p.symbol}:${p.exchange}`)).toEqual([
      "INFY:NYSE",
      "HDFCBANK:NSE",
      "HINDUNILVR:NSE",
      "KOTAKBANK:NSE",
    ]);
  });
});

describe("parseGoogleFinance: dividend yield", () => {
  it("reads the yield (percent) from the profile", () => {
    expect(parsed().stats.dividendYield).toBeCloseTo(0.3255, 3);
  });
});

describe("parseGoogleFinance: optional insights", () => {
  it("leaves everything empty for a bare quote entry", () => {
    const r = parseGoogleFinance(blob(zedEntry), "ZZZ", "NASDAQ");
    if (!r.ok) throw new Error(r.reason);
    expect(r.quote.peers).toEqual([]);
    expect(r.quote.analyst).toBeUndefined();
    expect(r.quote.marketHours).toBeUndefined();
    expect(r.quote.stats.dividendYield).toBeUndefined();
  });
});

describe("parseGoogleFinance: extended-hours quote", () => {
  const afterHoursHtml = readFileSync(join(__dirname, "fixtures/AAPL-NASDAQ-afterhours-2026-11-03.html"), "utf8");
  const relianceHtml = readFileSync(join(__dirname, "fixtures/RELIANCE-NSE.html"), "utf8");

  it("reads the after-hours quote while keeping the regular close as the headline price", () => {
    const r = parseGoogleFinance(afterHoursHtml, "AAPL", "NASDAQ");
    if (!r.ok) throw new Error(r.reason);
    const q = r.quote;
    expect(q.price).toBeCloseTo(331.9, 2);
    expect(q.updatedAt).toBe(1793742265);
    expect(q.marketHours?.close).toBe(1793739600);
    expect(q.extended).toMatchObject({ label: "After hours", price: 330.06, at: 1793742265 });
    expect(q.extended?.change).toBeCloseTo(-1.84, 2);
    expect(q.extended?.changePercent).toBeCloseTo(-0.5544, 3);
    // the extended change is measured against the regular close
    expect(q.price + (q.extended?.change ?? 0)).toBeCloseTo(q.extended?.price ?? 0, 2);
  });

  it("does not report a regular-session tick as an extended quote", () => {
    expect(parsed().extended).toBeUndefined();
  });

  it("has no extended quote when the market is closed and the slot is empty", () => {
    const r = parseGoogleFinance(relianceHtml, "RELIANCE", "NSE");
    if (!r.ok) throw new Error(r.reason);
    expect(r.quote.extended).toBeUndefined();
  });

  describe("synthetic pre-market shape (inferred, unverified against a real page)", () => {
    const epoch = (h: number, min: number) => Date.UTC(1970, 0, 1, h, min) / 1000 + 18000;
    const openEpoch = epoch(9, 30);
    const window = [[1, [1970, 1, 1, 9, 30, null, null, [-18000]], [1970, 1, 1, 16, null, null, null, [-18000]]]];
    const entryAt = (ts: number, win: unknown = window) => [
      "/m/x", ["ZZZ", "NASDAQ"], "Zed Corp", 0, "USD", [10, 0.5, 5.26, 2, 2, 2], null, 9.5,
      null, null, null, [1000], null, -18000, null, null,
      [10.4, 0.4, 4, 2, 2, 2], [900], [ts], win,
    ];
    const run = (entry: unknown[]) => {
      const r = parseGoogleFinance(blob(entry), "ZZZ", "NASDAQ");
      if (!r.ok) throw new Error(r.reason);
      return r.quote;
    };

    it("labels a quote stamped before the open as Pre-market", () => {
      const q = run(entryAt(openEpoch - 3600));
      expect(q.extended).toEqual({ label: "Pre-market", price: 10.4, change: 0.4, changePercent: 4, at: openEpoch - 3600 });
    });

    it("ignores a quote stamped inside the session window", () => {
      expect(run(entryAt(openEpoch + 60)).extended).toBeUndefined();
    });

    it("ignores the slot when the session window is missing", () => {
      expect(run(entryAt(openEpoch - 3600, null)).extended).toBeUndefined();
    });
  });
});

describe("parseGoogleFinance: index page (no currency, no company profile)", () => {
  const indexHtml = readFileSync(join(__dirname, "fixtures/NIFTY_50-INDEXNSE-2026-11-04.html"), "utf8");

  it("parses an index quote whose currency is null", () => {
    const r = parseGoogleFinance(indexHtml, "NIFTY_50", "INDEXNSE");
    if (!r.ok) throw new Error(`expected ok, got ${r.kind}: ${r.reason}`);
    const q = r.quote;
    expect(q.name).toBe("NIFTY 50");
    expect(q.currency).toBe("");
    expect(q.price).toBeGreaterThan(1000);
    expect(q.price - q.previousClose).toBeCloseTo(q.change, 1);
    expect(q.stats.high).toBeGreaterThan(q.stats.low ?? 0);
  });

  it("finds the chart candles for an index (chart entries carry a null currency too)", () => {
    const r = parseGoogleFinance(indexHtml, "NIFTY_50", "INDEXNSE");
    if (!r.ok) throw new Error(r.reason);
    expect(r.quote.intraday.length).toBeGreaterThan(10);
    expect(r.quote.daily.length).toBeGreaterThan(10);
  });
});
