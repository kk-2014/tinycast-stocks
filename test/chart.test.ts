import { describe, expect, it } from "vitest";
import { buildChartSvg, formatAxisTime, sparkline, svgToDataUri } from "../src/chart";
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
