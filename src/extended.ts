import { money, signed, timeAgo } from "./format";
import type { Extended } from "./types";

/** `🌙 **After hours:** $330.06  -1.84 (-0.55%) · 1m ago` (🌅 for pre-market). */
export function extendedLine(ext: Extended, currency: string, nowMs: number = Date.now()): string {
  const icon = ext.label === "Pre-market" ? "🌅" : "🌙";
  return `${icon} **${ext.label}:** ${money(ext.price, currency)}  ${signed(ext.change)} (${signed(ext.changePercent)}%) · ${timeAgo(ext.at, nowMs)}`;
}
