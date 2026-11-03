import { LocalStorage } from "@raycast/api";
import type { KV } from "./cache";

export const raycastKV: KV = {
  get: async (key) => (await LocalStorage.getItem<string>(key)) ?? undefined,
  set: (key, value) => LocalStorage.setItem(key, value),
};
