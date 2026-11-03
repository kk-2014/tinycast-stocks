import type { Candle } from "./types";

export interface ChartOptions {
  width?: number;
  height?: number;
  /** Dashed reference line and up/down colour reference (1D chart). */
  previousClose?: number;
}

const UP = "#34a853";
const DOWN = "#ea4335";
const AXIS = "#8e8e93";
const FONT = `font-family="-apple-system, Helvetica, Arial, sans-serif" font-size="11"`;
const RIGHT_GUTTER = 46;
const BOTTOM_GUTTER = 22;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Axis label from an exchange-local ISO string. Parsed textually so no timezone
 * conversion happens: intraday -> "h:mm AM/PM", otherwise "Mon D".
 */
export function formatAxisTime(iso: string, intraday: boolean): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(iso);
  if (!m) return "";
  if (intraday) {
    const h = Number(m[4] ?? 0);
    const suffix = h >= 12 ? "PM" : "AM";
    return `${h % 12 === 0 ? 12 : h % 12}:${m[5] ?? "00"} ${suffix}`;
  }
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
}

export function buildChartSvg(candles: Candle[], options: ChartOptions = {}): string | null {
  if (candles.length < 2) return null;
  const width = options.width ?? 640;
  const height = options.height ?? 260;
  const pad = 8;
  const closes = candles.map((c) => c.close);
  const reference = options.previousClose;
  const values = reference === undefined ? closes : [...closes, reference];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;

  const plotRight = width - RIGHT_GUTTER;
  const plotBottom = height - BOTTOM_GUTTER;
  const x = (i: number) => pad + (i / (closes.length - 1)) * (plotRight - pad);
  const y = (v: number) => pad + (1 - (v - lo) / span) * (plotBottom - pad);
  const point = (i: number) => `${x(i).toFixed(1)} ${y(closes[i]).toFixed(1)}`;

  const up = closes[closes.length - 1] >= (reference ?? closes[0]);
  const color = up ? UP : DOWN;
  const line = closes.map((_, i) => `${i === 0 ? "M" : "L"}${point(i)}`).join(" ");
  const area = `${line} L${x(closes.length - 1).toFixed(1)} ${plotBottom} L${x(0).toFixed(1)} ${plotBottom} Z`;
  const refLine =
    reference === undefined
      ? ""
      : `<line x1="${pad}" x2="${plotRight}" y1="${y(reference).toFixed(1)}" y2="${y(reference).toFixed(1)}" stroke="#888" stroke-width="1" stroke-dasharray="4 4"/>`;

  const tickValues = hi === lo ? [lo] : [0, 1, 2, 3].map((k) => hi - (k / 3) * (hi - lo));
  const yAxis = tickValues
    .map((v) => {
      const ty = y(v).toFixed(1);
      return (
        `<line class="grid" x1="${pad}" x2="${plotRight}" y1="${ty}" y2="${ty}" stroke="${AXIS}" stroke-opacity="0.25" stroke-width="1"/>` +
        `<text class="ylabel" x="${plotRight + 4}" y="${(y(v) + 4).toFixed(1)}" text-anchor="start" fill="${AXIS}" ${FONT}>${v.toFixed(2)}</text>`
      );
    })
    .join("");

  const intraday = candles.every((c) => c.time.slice(0, 10) === candles[0].time.slice(0, 10));
  const labelCount = Math.min(4, candles.length);
  const xAxis = Array.from({ length: labelCount }, (_, k) => {
    const i = Math.round((k * (candles.length - 1)) / (labelCount - 1));
    const anchor = k === 0 ? "start" : k === labelCount - 1 ? "end" : "middle";
    return `<text class="xlabel" x="${x(i).toFixed(1)}" y="${height - 6}" text-anchor="${anchor}" fill="${AXIS}" ${FONT}>${formatAxisTime(candles[i].time, intraday)}</text>`;
  }).join("");

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    yAxis +
    xAxis +
    `<path d="${area}" fill="${color}" fill-opacity="0.12"/>` +
    refLine +
    `<path class="line" d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>` +
    `</svg>`
  );
}

export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

const BLOCKS = "▁▂▃▄▅▆▇█";

/** Text fallback chart. */
export function sparkline(candles: Candle[]): string {
  if (candles.length === 0) return "";
  const closes = candles.map((c) => c.close);
  const lo = Math.min(...closes);
  const span = Math.max(...closes) - lo || 1;
  return closes.map((c) => BLOCKS[Math.min(7, Math.floor(((c - lo) / span) * 8))]).join("");
}
