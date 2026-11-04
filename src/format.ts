export function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(2)}K`;
  return String(Math.round(n));
}

/** Lakh/crore scale: 1 L = 1e5, 1 Cr = 1e7, 1 L Cr = 1e12. */
export function compactIndian(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e12) return `${(n / 1e12).toFixed(2)}L Cr`;
  if (a >= 1e7) return `${(n / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${(n / 1e5).toFixed(2)} L`;
  return String(Math.round(n));
}

export function compactFor(currency: string): (n: number) => string {
  return currency === "INR" ? compactIndian : compact;
}

export function money(n: number, currency: string): string {
  // Indices have no currency: show plain points.
  if (!currency) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  try {
    return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

export function signed(n: number, digits = 2): string {
  const s = n.toFixed(digits);
  if (Number(s) === 0) return (0).toFixed(digits);
  return n > 0 ? `+${s}` : s;
}

export function timeAgo(epochSeconds: number, nowMs: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor(nowMs / 1000 - epochSeconds));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
