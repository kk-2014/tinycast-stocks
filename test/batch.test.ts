import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "../src/batch";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("mapWithConcurrency", () => {
  it("preserves input order", async () => {
    const out = await mapWithConcurrency([30, 5, 15, 1], 2, async (n) => {
      await sleep(n);
      return n * 2;
    });
    expect(out).toEqual([60, 10, 30, 2]);
  });

  it("never runs more than `limit` at once", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 3, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await sleep(5);
      inFlight--;
    });
    expect(peak).toBe(3);
  });

  it("returns [] for empty input", async () => {
    expect(await mapWithConcurrency([], 3, async (x: number) => x)).toEqual([]);
  });

  it("handles a limit larger than the item count", async () => {
    expect(await mapWithConcurrency([1, 2], 10, async (x) => x + 1)).toEqual([2, 3]);
  });

  it("rejects if fn rejects", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (x) => {
        if (x === 2) throw new Error("boom");
        return x;
      }),
    ).rejects.toThrow("boom");
  });
});
