import { describe, expect, it } from "vitest";
import { buildChartSvg, downsample, formatAxisTime, rangeChange, sparkline, svgToDataUri } from "../src/chart";
import type { Candle } from "../src/types";

const candle = (close: number, i: number): Candle => ({
  open: close,
  close,
  high: close,
  low: close,
  time: `2026-11-0${i + 1}T16:00:00-05:00`,
  volume: 1,
});

describe("buildChartSvg", () => {
  it("returns null with fewer than 2 candles", () => {
    expect(buildChartSvg([candle(1, 0)])).toBeNull();
  });

  it("draws one path point per candle", () => {
    const svg = buildChartSvg([1, 2, 3, 2].map(candle))!;
    expect(svg.startsWith("<svg")).toBe(true);
    const line = svg.match(/<path class="line" d="([^"]+)"/)![1];
    expect(line.split(" L").length).toBe(4);
  });

  it("is green when the last close is above the reference, red otherwise", () => {
    expect(buildChartSvg([1, 2].map(candle))).toContain("#34a853");
    expect(buildChartSvg([2, 1].map(candle))).toContain("#ea4335");
    expect(buildChartSvg([1, 2].map(candle), { previousClose: 5 })).toContain("#ea4335");
  });

  it("does not divide by zero on a flat series", () => {
    const svg = buildChartSvg([5, 5, 5].map(candle))!;
    expect(svg).not.toContain("NaN");
  });
});

const at = (close: number, time: string): Candle => ({ open: close, close, high: close, low: close, time, volume: 1 });
const count = (svg: string, cls: string) => (svg.match(new RegExp(`class="${cls}"`, "g")) ?? []).length;

describe("buildChartSvg axes", () => {
  it("labels min and max and draws 4 gridlines", () => {
    const candles = Array.from({ length: 101 }, (_, i) => at(100 + i, `2026-10-${String(1 + Math.floor(i / 10)).padStart(2, "0")}T16:00:00-04:00`));
    const svg = buildChartSvg(candles)!;
    expect(svg).toContain(">100.00<");
    expect(svg).toContain(">200.00<");
    expect(count(svg, "grid")).toBe(4);
    expect(count(svg, "ylabel")).toBe(4);
  });

  it("uses h:mm AM/PM x labels for intraday candles", () => {
    const times = ["09:30", "11:00", "12:30", "13:45", "15:00", "16:00"];
    const svg = buildChartSvg(times.map((t, i) => at(10 + i, `2026-11-03T${t}:00-05:00`)))!;
    expect(svg).toContain(">9:30 AM<");
    expect(svg).toContain(">4:00 PM<");
    expect(count(svg, "xlabel")).toBe(4);
    expect(svg).toContain('text-anchor="start"');
    expect(svg).toContain('text-anchor="end"');
    expect(svg).toContain('text-anchor="middle"');
  });

  it("uses Mon D x labels for multi-day candles", () => {
    const days = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-12"];
    const svg = buildChartSvg(days.map((d, i) => at(10 + i, `${d}T16:00:00-04:00`)))!;
    expect(svg).toContain(">Oct 5<");
    expect(svg).toContain(">Oct 12<");
    expect(count(svg, "xlabel")).toBe(4);
  });

  it("renders a single y label on a flat series", () => {
    const svg = buildChartSvg([5, 5, 5].map(candle))!;
    expect(svg).not.toContain("NaN");
    expect(count(svg, "ylabel")).toBe(1);
    expect(count(svg, "grid")).toBe(1);
  });

  it("includes previousClose in the y range", () => {
    const svg = buildChartSvg([at(10, "2026-11-03T09:30:00-05:00"), at(11, "2026-11-03T10:00:00-05:00")], { previousClose: 20 })!;
    expect(svg).toContain(">20.00<");
    expect(svg).toContain(">10.00<");
  });

  it.each([2, 3])("renders distinct x labels for %i candles", (n) => {
    const svg = buildChartSvg(Array.from({ length: n }, (_, i) => at(1 + i, `2026-10-0${5 + i}T16:00:00-04:00`)))!;
    expect(count(svg, "xlabel")).toBe(n);
    const texts = [...svg.matchAll(/class="xlabel"[^>]*>([^<]*)</g)].map((m) => m[1]);
    expect(new Set(texts).size).toBe(n);
    expect(svg).not.toContain("NaN");
  });

  it("keeps the line path point count", () => {
    const svg = buildChartSvg([1, 2, 3, 2, 5].map(candle))!;
    expect(svg.match(/<path class="line" d="([^"]+)"/)![1].split(" L").length).toBe(5);
  });
});

describe("formatAxisTime", () => {
  it("formats intraday times without timezone conversion", () => {
    expect(formatAxisTime("2026-11-03T13:45:00-05:00", true)).toBe("1:45 PM");
    expect(formatAxisTime("2026-11-03T00:05:00-05:00", true)).toBe("12:05 AM");
    expect(formatAxisTime("2026-11-03T12:00:00-05:00", true)).toBe("12:00 PM");
  });
  it("formats dates as Mon D", () => {
    expect(formatAxisTime("2026-10-05T16:00:00-04:00", false)).toBe("Oct 5");
  });
});

describe("svgToDataUri", () => {
  it("base64-encodes the svg", () => {
    expect(svgToDataUri("<svg/>")).toBe("data:image/svg+xml;base64,PHN2Zy8+");
  });
});

describe("sparkline", () => {
  it("maps min to the lowest block and max to the highest", () => {
    expect(sparkline([1, 2, 3, 4, 5, 6, 7, 8].map(candle))).toBe("▁▂▃▄▅▆▇█");
  });
  it("is empty for no candles", () => {
    expect(sparkline([])).toBe("");
  });
});

describe("formatAxisTime with a span", () => {
  it("keeps the old behaviour without a span", () => {
    expect(formatAxisTime("2026-11-03T09:30:00-05:00", true)).toBe("9:30 AM");
    expect(formatAxisTime("2025-11-03", false)).toBe("Nov 3");
  });

  it("uses 'Mon D' up to ~6 months", () => {
    expect(formatAxisTime("2026-05-01", false, { first: "2026-05-01", last: "2026-10-30" })).toBe("May 1");
  });

  it("uses \"Mon 'YY\" between ~6 months and ~2 years", () => {
    expect(formatAxisTime("2025-11-07", false, { first: "2025-11-07", last: "2026-10-30" })).toBe("Nov '25");
    expect(formatAxisTime("2024-12-01", false, { first: "2024-12-01", last: "2026-10-30" })).toBe("Dec '24");
  });

  it("uses the year beyond ~2 years", () => {
    expect(formatAxisTime("2021-11-05", false, { first: "2021-11-05", last: "2026-10-30" })).toBe("2021");
    expect(formatAxisTime("1986-11-07", false, { first: "1986-11-07", last: "2026-10-30" })).toBe("1986");
  });

  it("is used by buildChartSvg for long series", () => {
    const long = [at(1, "2021-11-05"), at(2, "2023-01-02"), at(3, "2024-06-03"), at(4, "2026-10-30")];
    const svg = buildChartSvg(long)!;
    expect(svg).toContain(">2021<");
    expect(svg).toContain(">2026<");
    const mid = [at(1, "2025-11-07"), at(2, "2026-03-02"), at(3, "2026-10-30")];
    expect(buildChartSvg(mid)!).toContain(">Nov '25<");
  });
});

describe("downsample", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => at(i, `2026-01-01`));

  it("returns short series unchanged", () => {
    const c = many(400);
    expect(downsample(c)).toBe(c);
    expect(downsample(many(3))).toHaveLength(3);
  });

  it("reduces 2087 points to exactly 400, keeping first, last and order", () => {
    const c = many(2087);
    const d = downsample(c);
    expect(d).toHaveLength(400);
    expect(d[0]).toBe(c[0]);
    expect(d[399]).toBe(c[2086]);
    const closes = d.map((x) => x.close);
    expect(closes).toEqual([...closes].sort((a, b) => a - b));
    expect(new Set(closes).size).toBe(400);
  });

  it("honours a custom max", () => {
    expect(downsample(many(100), 10)).toHaveLength(10);
  });

  it("is applied inside buildChartSvg", () => {
    const c = Array.from({ length: 2087 }, (_, i) => at(100 + (i % 17), `${1986 + Math.floor(i / 52)}-06-01`));
    const svg = buildChartSvg(c)!;
    const line = svg.match(/<path class="line" d="([^"]+)"/)![1];
    expect(line.split(" L").length).toBeLessThanOrEqual(400);
  });
});

describe("rangeChange", () => {
  it("compares the last close with the first close by default", () => {
    const r = rangeChange([at(100, "2026-01-01"), at(150, "2026-01-02"), at(110, "2026-01-03")])!;
    expect(r.abs).toBeCloseTo(10);
    expect(r.pct).toBeCloseTo(10);
  });

  it("uses an explicit reference", () => {
    const r = rangeChange([at(90, "2026-01-01")], 100)!;
    expect(r.abs).toBeCloseTo(-10);
    expect(r.pct).toBeCloseTo(-10);
  });

  it("is undefined without candles or with a zero reference", () => {
    expect(rangeChange([])).toBeUndefined();
    expect(rangeChange([at(5, "2026-01-01")], 0)).toBeUndefined();
  });
});
