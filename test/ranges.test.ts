import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Fetcher, FetchResponse } from "../src/http";
import { parseBatchExecute } from "../src/parse";
import { fetchRange, RANGES } from "../src/ranges";
import type { Session } from "../src/types";

const fixture = (code: number) => readFileSync(join(__dirname, `fixtures/range-AAPL-NASDAQ-${code}.txt`), "utf8");

const session: Session = { sid: "2687335666710963568", bl: "boq_finhub-uiserver_20261101.02_p0", base: "/finance/_/FinHubUi" };

describe("parseBatchExecute", () => {
  const cases: [number, number, string, string][] = [
    [2, 68, "2026-10-28T09:30:00-04:00", "2026-11-03T15:00:00-05:00"],
    [4, 27, "2026-05-01", "2026-10-30"],
    [5, 211, "2025-12-31", "2026-11-02"],
    [6, 52, "2025-11-07", "2026-10-30"],
    [7, 261, "2021-11-05", "2026-10-30"],
    [8, 2087, "1986-11-07", "2026-10-30"],
  ];
  for (const [code, n, first, last] of cases) {
    it(`decodes range code ${code}`, () => {
      const r = parseBatchExecute(fixture(code), "AAPL", "NASDAQ");
      if (!r.ok) throw new Error(r.reason);
      expect(r.candles).toHaveLength(n);
      expect(r.candles[0].time.startsWith(first)).toBe(true);
      expect(r.candles[n - 1].time.startsWith(last)).toBe(true);
    });
  }

  it("code 5D keeps the exact time strings", () => {
    const r = parseBatchExecute(fixture(2), "AAPL", "NASDAQ");
    if (!r.ok) throw new Error(r.reason);
    expect(r.candles[0].time).toBe("2026-10-28T09:30:00-04:00");
    expect(r.candles[67].time).toBe("2026-11-03T15:00:00-05:00");
  });

  it.each([
    ["garbled text", "not a batchexecute response at all"],
    ["empty string", ""],
    ["wrong rpc id", `)]}'\n\n40\n[["wrb.fr","other","[1]",null,null,null,"generic"]]\n`],
    ["payload that is not JSON", `)]}'\n\n40\n[["wrb.fr","c2u4wc","not json",null,null,null,"generic"]]\n`],
    ["payload without candles", `)]}'\n\n40\n[["wrb.fr","c2u4wc","[[[1,2]]]",null,null,null,"generic"]]\n`],
  ])("fails cleanly on %s", (_name, text) => {
    const r = parseBatchExecute(text, "AAPL", "NASDAQ");
    expect(r).toMatchObject({ ok: false, kind: "layout" });
  });
});

const response = (body: string, status = 200): FetchResponse => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
});

function recorder(body = fixture(6), status = 200) {
  const calls: { url: string; init: Parameters<Fetcher>[1] }[] = [];
  const fetcher: Fetcher = async (url, init) => {
    calls.push({ url, init });
    return response(body, status);
  };
  return { calls, fetcher };
}

describe("fetchRange", () => {
  it("POSTs the c2u4wc RPC and returns candles", async () => {
    const { calls, fetcher } = recorder();
    const r = await fetchRange("AAPL", "NASDAQ", "1Y", session, { fetcher });
    expect(r.ok && r.candles.length).toBe(52);
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toContain("https://www.google.com/finance/_/FinHubUi/data/batchexecute?");
    expect(url).toContain("rpcids=c2u4wc");
    expect(url).toContain("f.sid=2687335666710963568");
    expect(url).toContain("bl=boq_finhub-uiserver_20261101.02_p0");
    expect(url).toContain("source-path=%2Ffinance%2Fquote%2FAAPL%3ANASDAQ");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded;charset=UTF-8");
    expect(init.headers["User-Agent"]).toBeTruthy();
    const outer = JSON.parse(new URLSearchParams(init.body).get("f.req")!);
    expect(outer).toEqual([[["c2u4wc", expect.any(String), null, "generic"]]]);
    expect(JSON.parse(outer[0][0][1])).toEqual([[[null, ["AAPL", "NASDAQ"]]], 6, null, null, null, null, null, 1]);
  });

  it("maps ranges to codes", async () => {
    const expected = { "5D": 2, "6M": 4, YTD: 5, "1Y": 6, "5Y": 7, MAX: 8 } as const;
    for (const [id, code] of Object.entries(expected)) {
      const { calls, fetcher } = recorder();
      await fetchRange("AAPL", "NASDAQ", id as keyof typeof expected, session, { fetcher });
      const outer = JSON.parse(new URLSearchParams(calls[0].init.body).get("f.req")!);
      expect(JSON.parse(outer[0][0][1])[1]).toBe(code);
    }
  });

  it("reports 403/429 as blocked", async () => {
    for (const status of [403, 429]) {
      const { fetcher } = recorder("", status);
      expect(await fetchRange("AAPL", "NASDAQ", "1Y", session, { fetcher })).toMatchObject({ ok: false, kind: "blocked" });
    }
  });

  it("reports other statuses as network", async () => {
    const { fetcher } = recorder("", 503);
    expect(await fetchRange("AAPL", "NASDAQ", "1Y", session, { fetcher })).toEqual({
      ok: false,
      kind: "network",
      reason: "Google Finance returned HTTP 503",
    });
  });

  it("does not hit the network for ranges served from the page", async () => {
    for (const id of ["1D", "1M"] as const) {
      const { calls, fetcher } = recorder();
      expect(await fetchRange("AAPL", "NASDAQ", id, session, { fetcher })).toMatchObject({ ok: false, kind: "layout" });
      expect(calls).toHaveLength(0);
    }
  });

  it("lists eight ranges in order", () => {
    expect(RANGES.map((r) => r.id)).toEqual(["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y", "MAX"]);
  });
});
