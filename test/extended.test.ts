import { describe, expect, it } from "vitest";
import { extendedLine } from "../src/extended";
import type { Extended } from "../src/types";

const now = 1_800_000_000_000;
const at = now / 1000 - 90;
const ext = (o: Partial<Extended> = {}): Extended => ({
  label: "After hours", price: 330.06, change: -1.84, changePercent: -0.55438274, at, ...o,
});

describe("extendedLine", () => {
  it("formats a negative after-hours move", () => {
    expect(extendedLine(ext(), "USD", now)).toBe("🌙 **After hours:** $330.06  -1.84 (-0.55%) · 1m ago");
  });

  it("formats a positive move with a plus sign", () => {
    expect(extendedLine(ext({ change: 0.4, changePercent: 4 }), "USD", now)).toBe(
      "🌙 **After hours:** $330.06  +0.40 (+4.00%) · 1m ago",
    );
  });

  it("uses the sunrise emoji for pre-market", () => {
    expect(extendedLine(ext({ label: "Pre-market" }), "USD", now)).toMatch(/^🌅 \*\*Pre-market:\*\* /);
  });

  it("uses INR formatting for INR", () => {
    expect(extendedLine(ext({ price: 1234.5 }), "INR", now)).toContain("₹1,234.50");
  });
});
