import { describe, expect, it } from "vitest";
import { getFresh, putFresh, type KV } from "../src/cache";

function memoryKV(): KV {
  const m = new Map<string, string>();
  return { get: async (k) => m.get(k), set: async (k, v) => void m.set(k, v) };
}

describe("cache", () => {
  it("returns a value within its TTL", async () => {
    const kv = memoryKV();
    await putFresh(kv, "k", { a: 1 }, 1000);
    expect(await getFresh(kv, "k", 60_000, 31_000)).toEqual({ a: 1 });
  });

  it("returns undefined after the TTL", async () => {
    const kv = memoryKV();
    await putFresh(kv, "k", { a: 1 }, 1000);
    expect(await getFresh(kv, "k", 60_000, 62_000)).toBeUndefined();
  });

  it("returns undefined for a missing or corrupt entry", async () => {
    const kv = memoryKV();
    expect(await getFresh(kv, "nope", 1000, 0)).toBeUndefined();
    await kv.set("bad", "{not json");
    expect(await getFresh(kv, "bad", 1000, 0)).toBeUndefined();
  });
});
