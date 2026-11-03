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
