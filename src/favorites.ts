export interface Fav {
  symbol: string;
  name: string;
}

export const FAVORITES_KEY = "favorites";

export function toggleFav(favs: Fav[], fav: Fav): Fav[] {
  return favs.some((f) => f.symbol === fav.symbol) ? favs.filter((f) => f.symbol !== fav.symbol) : [...favs, fav];
}

export function parseFavs(raw: string | undefined): Fav[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter(
      (f): f is Fav => !!f && typeof f.symbol === "string" && typeof f.name === "string",
    );
  } catch {
    return [];
  }
}
