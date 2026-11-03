import { money, signed } from "./format";
import type { Quote } from "./types";

/** The `### Insights` markdown block (analysts, price target, peers), or "" when there is nothing to show. */
export function insightsMarkdown(q: Quote): string {
  const lines: string[] = [];
  const a = q.analyst;
  if (a) {
    lines.push(`**Analysts:** ${a.rating} · ${a.count} analysts (${a.buy} Buy / ${a.hold} Hold / ${a.sell} Sell)`);
    const pct = q.price > 0 ? `, ${signed((a.targetAvg / q.price - 1) * 100)}% vs current price` : "";
    lines.push(
      `**Price target:** ${money(a.targetAvg, q.currency)} (low ${money(a.targetLow, q.currency)} – high ${money(a.targetHigh, q.currency)})${pct}`,
    );
  }
  if (q.peers.length > 0) {
    lines.push(
      `**Peers:** ${q.peers.map((p) => `${p.symbol} ${money(p.price, p.currency)} (${signed(p.changePercent)}%)`).join(" · ")}`,
    );
  }
  return lines.length ? `### Insights\n\n${lines.join("\n\n")}` : "";
}
