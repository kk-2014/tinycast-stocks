import type { MarketHours } from "./types";

export type MarketStatus = { state: "open" | "closed" | "opens-later"; label: string };

/** `5400` -> "1h 30m"; under a minute -> "<1m"; a day or more -> "1d 1h". */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  if (total < 60) return "<1m";
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const parts: [number, string][] = d > 0 ? [[d, "d"], [h, "h"]] : [[h, "h"], [m, "m"]];
  return parts.filter(([n]) => n > 0).map(([n, u]) => `${n}${u}`).join(" ");
}

export function marketStatus(hours: MarketHours | undefined, nowMs: number = Date.now()): MarketStatus | undefined {
  if (!hours) return undefined;
  const now = nowMs / 1000;
  if (now >= hours.close) return { state: "closed", label: "Market closed" };
  if (now < hours.open) return { state: "opens-later", label: `Opens in ${formatDuration(hours.open - now)}` };
  return { state: "open", label: `Market open · closes in ${formatDuration(hours.close - now)}` };
}
