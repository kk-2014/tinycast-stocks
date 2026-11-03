export interface Fav {
  symbol: string;
  name: string;
  /** "NSE" / "BOM" for Indian listings; absent for US ones (found by probing). */
  exchange?: string;
}

export const FAVORITES_KEY = "favorites";

export const favKey = (f: { symbol: string; exchange?: string }) => `${f.exchange ?? ""}:${f.symbol}`;

export function toggleFav(favs: Fav[], fav: Fav): Fav[] {
  const key = favKey(fav);
  return favs.some((f) => favKey(f) === key) ? favs.filter((f) => favKey(f) !== key) : [...favs, fav];
}

export function parseFavs(raw: string | undefined): Fav[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value
      .filter((f) => !!f && typeof f.symbol === "string" && typeof f.name === "string")
      .map((f): Fav => {
        const fav: Fav = { symbol: f.symbol, name: f.name };
        if (typeof f.exchange === "string") fav.exchange = f.exchange;
        return fav;
      });
  } catch {
    return [];
  }
}
