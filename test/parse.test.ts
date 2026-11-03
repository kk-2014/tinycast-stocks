import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseGoogleFinance } from "../src/parse";

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
