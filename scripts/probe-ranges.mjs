// Probe: can we load Google Finance chart ranges beyond 1D/1M?
// Usage (run in your own Terminal, not in the Claude sandbox):
//   node scripts/probe-ranges.mjs [SYMBOL] [EXCHANGE]
// Saves raw responses to test/fixtures/range-<SYMBOL>-<EXCHANGE>-<code>.txt
import { writeFileSync } from "node:fs";

const [symbol = "AAPL", exchange = "NASDAQ"] = process.argv.slice(2);
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const pageRes = await fetch(`https://www.google.com/finance/quote/${symbol}:${exchange}`, {
  headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
});
const html = await pageRes.text();
const sid = html.match(/"FdrFJe":"([^"]+)"/)?.[1];
const bl = html.match(/"cfb2h":"([^"]+)"/)?.[1];
const base = html.match(/"Im6cmf":"([^"]+)"/)?.[1] ?? "/finance/_/FinHubUi";
const at = html.match(/"SNlM0e":"([^"]+)"/)?.[1];
console.log(`page HTTP ${pageRes.status}`, { sid, bl, base, at: at ? "present" : "absent" });
if (!sid || !bl) {
  console.log("Could not find session tokens in the page; stopping.");
  process.exit(1);
}

const fixtures = new URL("../test/fixtures/", import.meta.url);
for (const range of [2, 4, 5, 6, 7, 8]) {
  const inner = JSON.stringify([[[null, [symbol, exchange]]], range, null, null, null, null, null, 1]);
  const freq = JSON.stringify([[["c2u4wc", inner, null, "generic"]]]);
  const url =
    `https://www.google.com${base}/data/batchexecute?` +
    new URLSearchParams({
      rpcids: "c2u4wc",
      "source-path": `/finance/quote/${symbol}:${exchange}`,
      "f.sid": sid,
      bl,
      hl: "en",
      rt: "c",
    });
  const body = new URLSearchParams({ "f.req": freq });
  if (at) body.set("at", at);
  const res = await fetch(url, {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body,
  });
  const text = await res.text();
  writeFileSync(new URL(`range-${symbol}-${exchange}-${range}.txt`, fixtures), text);
  console.log(`range ${range}: HTTP ${res.status}, ${text.length} bytes:`, text.slice(0, 110).replace(/\n/g, " "));
}
