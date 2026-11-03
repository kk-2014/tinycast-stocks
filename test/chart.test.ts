import { describe, expect, it } from "vitest";
import { buildChartSvg, sparkline, svgToDataUri } from "../src/chart";
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
