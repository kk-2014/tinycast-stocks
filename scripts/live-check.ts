import { fetchQuote } from "../src/google";

const SYMBOLS = process.argv.slice(2).length ? process.argv.slice(2) : ["AAPL", "MSFT", "SPY"];

async function main() {
  let failed = false;
  for (const symbol of SYMBOLS) {
    const r = await fetchQuote(symbol);
    if (!r.ok) {
      failed = true;
      console.log(`FAIL ${symbol}: [${r.kind}] ${r.reason}`);
      continue;
    }
    const q = r.quote;
    const problems = [
      q.stats.marketCap === undefined && "marketCap",
      q.stats.peRatio === undefined && "peRatio",
      q.intraday.length === 0 && "intraday",
      q.daily.length === 0 && "daily",
      q.news.length === 0 && "news",
    ].filter(Boolean);
    if (problems.length) failed = true;
    console.log(
      `${problems.length ? "WARN" : "OK  "} ${symbol}: ${q.price} (${q.exchange}) ` +
        `intraday=${q.intraday.length} daily=${q.daily.length} news=${q.news.length}` +
        (problems.length ? ` missing: ${problems.join(", ")}` : ""),
    );
  }
  process.exit(failed ? 1 : 0);
}

main();
