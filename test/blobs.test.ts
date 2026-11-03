import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractBlobs, walk } from "../src/blobs";

const html = readFileSync(join(__dirname, "fixtures/AAPL-NASDAQ-2026-11-03.html"), "utf8");

describe("extractBlobs", () => {
  it("decodes every AF_initDataCallback blob in the fixture", () => {
    expect(extractBlobs(html).length).toBe(20);
  });

  it("returns an empty array for a page with no blobs", () => {
    expect(extractBlobs("<html><body>nothing</body></html>")).toEqual([]);
  });

  it("handles brackets and escaped quotes inside strings", () => {
    const page = `AF_initDataCallback({key: 'ds:0', hash: '1', data:["a]b","q\\"[",[1,2]], sideChannel: {}});`;
    expect(extractBlobs(page)).toEqual([["a]b", 'q"[', [1, 2]]]);
  });
});

describe("extractBlobs: loosened header", () => {
  it("decodes negative hashes and non-numeric keys", () => {
    const page = `AF_initDataCallback({key: 'ds:abc', hash: '-1', data:[1,[2]], sideChannel: {}});`;
    expect(extractBlobs(page)).toEqual([[1, [2]]]);
  });
});

describe("walk", () => {
  it("visits parents before children, left to right", () => {
    const a = [[1], [[2]]];
    expect([...walk(a)]).toEqual([a, a[0], a[1], (a[1] as unknown[])[0]]);
  });

  it("survives 20000 levels of nesting", () => {
    let deep: unknown[] = [];
    for (let i = 0; i < 19999; i++) deep = [deep];
    expect([...walk(deep)].length).toBe(20000);
  });

  it("yields every nested array", () => {
    const seen = [...walk([1, [2, [3]], "x"])];
    expect(seen.length).toBe(3);
  });
});
