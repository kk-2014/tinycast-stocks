import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sparkline, svgToDataUri } from "./chart";
import type { Candle } from "./types";

/** Result of the Task 1 spike. One of: "data-uri" | "file-url" | "file-path" | "sparkline". */
export const CHART_MODE: "data-uri" | "file-url" | "file-path" | "sparkline" = "data-uri";

/** Markdown for the chart. `key` names the temp file for the file-based modes. */
export function chartMarkdown(svg: string | null, candles: Candle[], key: string): string {
  if (!svg) return "_No chart data available._";
  switch (CHART_MODE) {
    case "data-uri":
      return `![chart](${svgToDataUri(svg)})`;
    case "file-url":
    case "file-path": {
      const dir = join(tmpdir(), "tinycast-stocks");
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `${key.replace(/[^A-Za-z0-9_-]/g, "_")}.svg`);
      writeFileSync(file, svg);
      return CHART_MODE === "file-url" ? `![chart](file://${file})` : `![chart](${file})`;
    }
    case "sparkline":
      return `\`${sparkline(candles)}\``;
  }
}
