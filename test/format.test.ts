import { describe, expect, it } from "vitest";
import { compact, compactFor, compactIndian, money, signed, timeAgo } from "../src/format";

describe("compact", () => {
  it.each([
    [4842494830169, "4.84T"],
    [39698332, "39.70M"],
    [2_500_000_000, "2.50B"],
    [12_500, "12.50K"],
    [999, "999"],
  ])("%d -> %s", (n, out) => expect(compact(n)).toBe(out));
});

describe("compactIndian", () => {
  it.each([
    [17_671_030_535_424, "17.67L Cr"],
    [42_319_913, "4.23 Cr"],
    [6_338_512_384, "633.85 Cr"],
    [250_000, "2.50 L"],
    [99_999, "99999"],
    [-2_500_000, "-25.00 L"],
  ])("%d -> %s", (n, out) => expect(compactIndian(n)).toBe(out));
});

describe("compactFor", () => {
  it("picks the Indian scale for INR only", () => {
    expect(compactFor("INR")).toBe(compactIndian);
    expect(compactFor("USD")).toBe(compact);
  });
});

describe("money", () => {
  it("formats USD", () => expect(money(331.775, "USD")).toBe("$331.78"));
  it("formats INR with lakh grouping", () => {
    expect(money(1307.9, "INR")).toBe("₹1,307.90");
    expect(money(1307900, "INR")).toBe("₹13,07,900.00");
  });
  it("falls back for an invalid currency code", () => expect(money(1.5, "ZZZZ")).toBe("1.50 ZZZZ"));
});

describe("signed", () => {
  it("adds a plus sign for positives", () => expect(signed(1.234)).toBe("+1.23"));
  it("keeps the minus for negatives", () => expect(signed(-6.5)).toBe("-6.50"));
  it("shows zero without a sign", () => expect(signed(0)).toBe("0.00"));
  it("does not show negative zero after rounding", () => expect(signed(-0.001)).toBe("0.00"));
});

describe("timeAgo", () => {
  const now = 1_800_000_000_000;
  const at = (secondsAgo: number) => now / 1000 - secondsAgo;
  it("seconds", () => expect(timeAgo(at(30), now)).toBe("just now"));
  it("minutes", () => expect(timeAgo(at(5 * 60), now)).toBe("5m ago"));
  it("hours", () => expect(timeAgo(at(3 * 3600), now)).toBe("3h ago"));
  it("days", () => expect(timeAgo(at(2 * 86400), now)).toBe("2d ago"));
});

describe("money without a currency (indices)", () => {
  it("formats as a plain number with no trailing space", () => {
    expect(money(23809.45, "")).toBe("23,809.45");
  });
});
