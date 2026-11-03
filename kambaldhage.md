# Tinycast Stocks, Explained for Kambaldhage

*A project diary: how a row stuck on "Loading quote..." turned into a small, honest, well-tested stock lookup, and what it teaches.*

---

## 1. What this thing is

Imagine pressing a hotkey, typing "apple", and instantly seeing the price, today's change, a little chart, a stats panel and the latest headlines, all without opening a browser. That is Tinycast Stocks.

It is an extension for **Tinycast**, a tiny native macOS launcher that runs Raycast-style extensions. The data comes from **Google Finance** (quote, stats, chart, news). Search, the "which ticker do you mean?" part, comes from stockanalysis.com.

It exists because of an annoyance. The extension that was already installed showed every result as **"Loading quote..."**, forever. Not slow. Never. This project is the story of finding out why, then building something that cannot fail that quietly again.

---

## 2. The detective story

Every good bug hunt starts with a screenshot: a list of tickers, each one stubbornly saying "Loading quote...".

**The extension was a sealed box.** What was installed turned out to be a minified bundle, one long unreadable line of JavaScript. Reading it was like reverse-engineering a recipe from the smell of the kitchen. But the clues were there. It fetched Google Finance pages and then went looking for an attribute called `data-last-price` and for CSS classes with names like `mfs7Fc`. That is **scraping**: grabbing the page's visible HTML and hoping the furniture never moves.

**Search worked, quotes didn't.** Typing a name found tickers (that goes to stockanalysis.com, a different source). So the failure was specific to quote scraping. Why did it fail without a peep? Because every failure path in the code did `continue`, meaning "shrug, try the next thing". And the UI had exactly two states: loading and loaded. No "failed" state existed. So a failure had nowhere to go and **looked identical to loading**. The bug was not just a broken parser. It was a design that made breakage invisible.

**The first test lied.** I tried `curl` against Google from inside the Claude sandbox and got HTTP 000 and 403. Tempting conclusion: "Google is blocking scripts!" But the sandbox sits behind a proxy that blocks things on its own. That test told me about the sandbox, not about the real world. (More in the lessons.)

**The haunted paste.** At one point a shell command got garbled in a paste, and `curl` treated the word `grep` as a *hostname*. It cheerfully tried to look it up as a real host. A funny moment, and a good reminder that tools do exactly what the text says, not what you meant.

**The smoking gun.** Finally you ran curl yourself, on your own machine, outside the sandbox. A 1.4 MB response came back. Google was not blocking us. I searched it: no `data-last-price`. None of the old CSS classes. Google had redesigned the page, and the scraper was looking for furniture that had been carted away. That response became our first test fixture.

**Then the discovery.** The data had not vanished. It had moved. The page was full of `AF_initDataCallback({key: 'ds:N', ..., data: [...]})` calls, which are JavaScript snippets that hand the page's own front-end a big JSON array. The price, the candles, the stats and the news were all sitting in there as structured data. The page was never empty. We had been reading the signage instead of the warehouse inventory.

---

## 3. How it's built, file by file

Think of the whole thing as a small assembly line: **search -> select -> fetch -> parse -> render.**

**Search (`src/search.ts`).** As you type, a debounced call goes to `stockanalysis.com/api/search` and returns up to 8 hits (stocks and ETFs, skipping odd symbols with a slash). Rows show only the symbol and name. There is deliberately no quote fetch per row (see section 4).

**Select and fetch (`src/useQuote.ts` and `src/google.ts`).** When you highlight a row, a React hook waits 250 ms for the selection to settle, checks a cache, and only then calls `fetchQuote`. The catch is that a ticker like `AAPL` does not say which exchange it lives on, and Google's URLs look like `/finance/quote/AAPL:NASDAQ`. So `fetchQuote` **probes**: it tries a list of exchanges (NASDAQ, NYSE, NYSEARCA, NYSEAMERICAN, BATS, and others such as LON, TSE, NSE...) one at a time, **starting with the exchange it remembered** last time for that symbol (the "hint", stored via `exchange:<SYM>`). It is like a waiter who remembers your usual table.

**Parse (`src/parse.ts`, `src/blobs.ts`).** This is the heart. `blobs.ts` finds every `AF_initDataCallback` and slices out its JSON array, carefully counting brackets while respecting strings and escapes, then `JSON.parse`s it. `parse.ts` then hunts through those blobs **by shape**: "an array whose second item is `[SYMBOL, EXCHANGE]`, whose third is a string, whose sixth is three numbers..." That is how it finds the headline quote, the trading stats, the company profile, the candles (5-minute and daily) and the news. The parser is **pure**: HTML string in, a typed result out, no network, no clock. That purity is why it is easy to test.

The result is a `ParseResult`: either `{ok: true, quote}` or `{ok: false, kind, reason}` where `kind` is `layout`, `not-found`, `blocked` or `network`. Every way to fail has a name and a message.

**Inject the world (`src/http.ts`).** Network access goes through a `Fetcher` type, a function you hand in. Production uses real `fetch`. Tests hand in a fake that returns saved HTML. It is like practising driving in a simulator instead of on the motorway.

**Cache (`src/cache.ts`, `src/kv.ts`).** A tiny wrapper that stamps each value with a timestamp and returns it only if it is younger than the TTL (60 seconds for quotes). `kv.ts` adapts Raycast's `LocalStorage` to the small `KV` interface the cache needs, so the cache logic doesn't depend on Raycast at all.

**Favorites (`src/favorites.ts`).** Pure helpers: toggle a favorite, and parse the stored JSON defensively (garbage in storage becomes an empty list, not a crash). With no search text, the list shows your favorites.

**Chart (`src/chart.ts`, `src/chartImage.ts`).** `buildChartSvg` turns candles into an SVG: a closing-price line, a faint filled area, green or red depending on direction, and for the 1-day chart a dashed line at the previous close. `chartImage.ts` embeds it in the detail pane's markdown as a base64 **data URI** (`CHART_MODE = "data-uri"`). The other modes (temp file URL, file path, text sparkline) are still in the code as fallbacks.

**UI (`src/index.tsx`).** A `List` with a detail pane: header with price and change, chart, a news list, and a metadata sidebar (open, high, low, market cap, 52-week range, P/E, and so on). Actions: open in Google Finance, pick a chart range (1D to Max, ⌘1 to ⌘8), favorite, refresh, copy price. Failures render as a visible "Quote unavailable" panel with the reason.

**Formatting (`src/format.ts`).** Small pure helpers: `compact` (1.23T), `money`, `signed`, `timeAgo`.

**Tinycast and the build.** Tinycast ships its own Raycast runtime shim, so it implements the `@raycast/api` surface (`List`, `Action`, `LocalStorage`) itself, possibly only partially. That is a risk, and it is why we spiked first (section 5g). `npx ray build` compiles the extension and installs it into `~/.config/raycast/extensions`, where Tinycast picks it up.

---

## 4. Technology choices, and the reasoning

- **TypeScript.** The parser deals with deeply unreliable data. Types force you to say what you believe about it.
- **vitest.** Fast, zero-config tests. The suite includes the real saved Google page (`test/fixtures/AAPL-NASDAQ-2026-11-03.html`).
- **tsx.** Runs a TypeScript file directly. It powers `scripts/live-check.ts` without a build step.
- **React plus `@raycast/api`.** It is the contract Tinycast's runtime speaks. Writing to it means the extension is Raycast-compatible.
- **SVG as a data URI.** No temp files, no filesystem permissions, no cleanup. One string.
- **Parse blobs by shape, not by `ds:N` key or CSS class.** The spec's own research notes say blob numbering "is not guaranteed stable". A key like `ds:13` is a house number, and houses get renumbered. A shape such as "this array has `[SYM, EXCH]` in slot 1 and three numbers in slot 5" is more like a face: it is recognisable wherever it turns up. CSS classes like `mfs7Fc` are the worst of all: they are generated names for styling, never promised to anyone.
- **Fetch details only for the highlighted row.** Ten search results times 14 exchanges per keystroke is a self-inflicted denial-of-service against someone else's server. One highlighted row, one debounce, one cache, and an `AbortController` that cancels stale requests is polite and fast.

---

## 5. Lessons, each with a story

**(a) Silent failure hides bugs.** The original bug was not "Google changed". It was "nobody could tell". `continue` on failure plus no failed state meant failure and loading were the same picture. Fix: `ParseResult` carries a `kind` and `reason`, and the UI renders them. If a thing can fail, give that failure a face.

**(b) Scraping CSS classes is a trap.** Classes exist for styling and change with every redesign. Structured data (the JSON the page itself uses) is a much more stable contract. It is not guaranteed, but it fails less often and in more obvious ways.

**(c) A number can be misread.** Early on, `326.21` looked like the price. The spec even quotes the shape `[326.21,-5.60,-1.69,...]`. But checking an invariant, `price - previousClose == change`, showed the true headline price was `331.775`. The `326.21` belonged to a different moment (the after-hours or reference figure in that part of the page). Lesson: when you reverse-engineer an undocumented format, don't trust that a plausible number is the right number. Find a relationship that must hold, and test it. Numbers that satisfy an invariant earn trust.

**(d) The peer-quote discovery.** The AAPL page also contains a perfectly valid *MSFT* quote entry (peers and comparisons are embedded). So a test that used MSFT as "this should be not found" was simply wrong, because the page does contain MSFT. The deeper truth, now a comment in `google.ts`: the parser cannot tell which symbol a page is "about", so **the URL is the source of truth**. We asked for `AAPL:NASDAQ`, so the parser looks for an entry whose symbol and exchange match exactly what we requested, not just the first quote it sees.

**(e) The contaminated news.** The page has two news containers. One was full of Indian-market headlines, a locale effect. Same page, different "regional" content. The fix in `findNews`: collect every group that looks like news (at least 3 items with a URL, title, source and timestamp), then pick the group whose titles mention the company short name or ticker most often (whole-word, Unicode-aware match, so "AAPL" doesn't match inside another word). If no group mentions the company at all, return no news rather than wrong news. Wrong news is worse than none.

**(f) Toolchains move.** TypeScript 7 removed `moduleResolution: node`. A tiny commit, "fix tsconfig for TypeScript 7", exists because the first scaffold used the old setting. Lesson: read the changelog of a major version before being surprised by it.

**(g) Spike before you build.** Before writing any UI, there was a throwaway experiment: four ways of embedding a chart (variants A to D: data URI, file URL, plain file path, text sparkline), to find out which Tinycast actually renders. Your eyes confirmed variant A, the data URI, so that is what `CHART_MODE` is set to. A 10-minute spike saved us from building a full UI on a feature the host app might not support. Cheap experiments first, expensive building second.

**(h) Know where you're testing from.** The 000/403 results came from the Claude sandbox's proxy, not from Google. Your own curl, from your own network, told the real story. Whenever a network test fails, ask "from whose point of view?" before concluding anything. Related: the `grep`-as-hostname paste. If a result is weird, check the command you actually ran before theorising about the world.

**(i) Pathological input.** The first walker over the parsed JSON was recursive. A deeply nested array could overflow the stack. Now `walk` in `blobs.ts` is **iterative** (an explicit stack), and `parseGoogleFinance` wraps everything in a try/catch and **never throws**. Anything unexpected becomes a `layout` failure with a message. If your input comes from the internet, assume it will eventually be strange.

---

## 6. Pitfalls and how to avoid them

- **Unofficial data source.** There is no public Google Finance API. We are reading a page meant for humans, which may break at any time and may conflict with Google's terms of service. Fine for a personal tool, but don't build a business on it, and don't redistribute the data.
- **Rate limiting.** Never probe all exchanges on every keystroke. The code stops immediately on HTTP 403, 429, or a redirect to `consent.google.com`, returning a `blocked` result instead of hammering on. Combined with the 60-second cache, the remembered exchange hint, debouncing and request cancellation, the footprint is small.
- **Drift detection.** Two layers: the saved fixture catches regressions in *our* code, and `npm run live-check` catches changes in *Google's* page. It fetches AAPL, MSFT and SPY live and flags missing market cap, P/E, candles or news. The fixture says "the code still understands the old page". The live check says "the old page is still the real page". You need both.
- **Locale-dependent pages.** Google serves different content by region (the Indian headlines). The fetch sends `Accept-Language: en-US` and the news step filters by relevance, but treat locale as a hidden input of every scraper.
- **Secrets and privacy.** None here. No API keys, no accounts, nothing personal stored beyond a favorites list in local storage.

---

## 7. How good engineers worked here

The workflow, in order:

1. **Brainstorm** the goal and the constraints.
2. **Write a spec** (`docs/superpowers/specs/2026-11-04-tinycast-stocks-design.md`) stating verified facts, architecture, error handling, risks.
3. **Write a plan** (`docs/superpowers/plans/2026-11-04-tinycast-stocks.md`) of small tasks.
4. **TDD with a real fixture.** Save a real page first, write the failing test against it, then make it pass. The git log reads like the plan: blobs, then headline quote, then stats, then candles, then news, then hardening.
5. **A fresh subagent per task**, each reviewed twice: first "does it match the spec?", then "is the code good?".
6. **Verify before claiming done.** Tests run, the build runs, and the human looks at the real thing in Tinycast.

Notice the spec contains a *Risks* section that names both of the things that later mattered: Google changing its blobs, and Tinycast's shim lacking features.

**To run it:**

- `npm test` runs the vitest suite against the saved fixture and fake fetchers.
- `npx ray build` builds the extension and installs it into `~/.config/raycast/extensions` for Tinycast.
- `npm run live-check` hits the real Google Finance. **Run it outside the sandbox**, or the proxy will give you the same misleading 403s as before. You can pass symbols: `npm run live-check -- NVDA QQQ`.

---

## 8. What I'd do next

- **More chart ranges.** Done, see section 10. (Originally the page only carried 1D and 1M, and we assumed a second data source was needed. We were wrong, which is the fun part.)
- **Single-candle charts.** `buildChartSvg` returns `null` below 2 candles, so a pre-market session with one candle shows "No chart data available". A dot or a text note would be kinder.
- **Non-US exchanges.** The probe list includes LON, TSE, NSE and others, but search is US-oriented and coverage is untested. Fixtures per region would settle it.
- **Real-time updates.** Right now you get a snapshot, refreshed by cache expiry or the Refresh action. Polling the highlighted row gently, with the same politeness rules, would make it feel alive.
- **A scheduled live-check** so drift shows up in a weekly report instead of in a user's "Quote unavailable" panel.

---

## Cheat sheet

| File | Job |
|---|---|
| `src/index.tsx` | The UI: list, detail pane, actions, favorites |
| `src/search.ts` | Name to tickers (stockanalysis.com) |
| `src/useQuote.ts` | Debounce, cache, abort, state: loading or done |
| `src/google.ts` | URL building, exchange probing, hints, blocked detection |
| `src/parse.ts` | Pure HTML to `ParseResult`, finds data by shape, never throws |
| `src/blobs.ts` | Extracts `AF_initDataCallback` JSON, iterative `walk` |
| `src/ranges.ts`, `src/useChart.ts` | Range list and RPC fetcher; the hook that serves 1D/1M from the page and the rest from Google's RPC |
| `src/types.ts` | `Quote`, `Candle`, `ParseResult` and the failure kinds |
| `src/chart.ts` and `src/chartImage.ts` | Candles to SVG, then to data-URI markdown |
| `src/cache.ts`, `src/kv.ts` | TTL cache and the Raycast storage adapter |
| `src/favorites.ts`, `src/format.ts`, `src/http.ts` | Favorites logic, display formatting, injectable `Fetcher` |
| `test/fixtures/AAPL-NASDAQ-2026-11-03.html` | The real page that proved Google changed |
| `scripts/live-check.ts` | Manual drift detector (run outside the sandbox) |
| `docs/superpowers/specs/` and `plans/` | The design and the task list |

**One sentence to remember:** when something fails, make the failure visible, and when something you scrape changes, go looking for the structured data underneath the paint.

---

## 9. Going to India: NSE and BSE

**The parser needed zero changes.** We pointed the existing `parseGoogleFinance` at a real `RELIANCE:NSE` page and it just worked: INR currency, 74 intraday candles stamped `+05:30`, news, stats, everything. That is the payoff of finding data by *shape* (a quote entry looks like this, a candle series looks like that) instead of by hard-coded array positions. Positions are a street address; shape is a face. Move house and the face is still recognisable. A new country, same face.

**The search results that vanished.** stockanalysis.com returns Indian stocks as `nse/RELIANCE` and `bom/500325`. The old `search.ts` had a line that dropped anything containing a `/`, written to throw out things like `BTC/USD`. It did its job so well it silently threw out an entire subcontinent, and nothing ever complained. Lesson: a filter written for one kind of junk will happily eat good data of a kind you hadn't met yet. Now the prefix decides: `nse` becomes exchange `NSE`, `bom` becomes `BOM`, and `asx`, `otc`, `dse`, `idx`, `tpex` and friends are still dropped. Indian items also use `t:"sy"` with the stock-or-ETF flag in `st`, so the rules differ slightly from the US ones.

**Why not Yahoo's search?** We tried it first. It answered 429 (too many requests). An unofficial, rate-limited endpoint is a bridge that closes when it feels like it, so we stayed with the one that works and did not build on it.

**Why BSE looks like `500325`.** Google Finance addresses BSE listings by their numeric scrip code (`500325:BOM`), not by a ticker name. Conveniently, stockanalysis uses the same codes (`bom/500325`), so the search hit's symbol can go straight into the URL. Notice `BOM` is Google's name for BSE (Bombay); the UI shows it as a `BSE` tag.

**Because we know the exchange, we skip probing.** US symbols are searched across NASDAQ, NYSE and others until one answers. An Indian hit already says where it lives, so `fetchQuote(symbol, { exchange })` makes exactly one request. A 404 means "not found", not "try the next exchange", which also keeps us polite to Google.

**Lakh and crore.** India groups digits as 13,07,900 (the first group is three digits, the rest are pairs), and big numbers are lakh (10^5) and crore (10^7). A *lakh crore* is 10^12, which is why Reliance's market cap reads `17.67L Cr` rather than "17.67T". We get the grouping free from `Intl.NumberFormat("en-IN")` and wrote a small `compactIndian` for the abbreviations. Tests pin both, so `₹1,307.90` and `₹13,07,900.00` can't quietly regress.

**Keys must include the exchange.** A symbol alone is not an identity: the same ticker can exist on two exchanges. So favourites, React row ids and the quote cache are all keyed by `exchange:symbol` (`favKey`, `quote:v2:NSE:RELIANCE`). The old `quote:v1:` cache keys were abandoned on purpose by bumping the version, and old favourites without an exchange still load, meaning "US, probe for it". Rule of thumb: if two different things can share a name, put the namespace in the key before the collision bug exists.


---

## 10. Chart ranges: eight buttons, one undocumented door

**The problem.** The quote page only carries two datasets: 5-minute candles for today and about a month of daily candles. So 1D and 1M were free, and 5D, 6M, YTD, 1Y, 5Y and Max looked like they needed a second source. We tried Yahoo's chart endpoint first. It answered **429**. Building on a rate-limited, unofficial endpoint is like building a house on a sandbar that appears at low tide.

**The break.** Then we looked at what Google's own page says about itself. Inside the same `AF_initDataCallback` soup there is a list called `AF_dataServiceRequests`: a table of contents of every dataset the page loads, with the RPC id and the request payload for each. The chart one is `c2u4wc`, and its request is just `[[[null,[SYMBOL,EXCHANGE]]], RANGE_CODE, null, null, null, null, null, 1]`. The page was never hiding anything; it was handing us the order form. Lesson: before you reach for a second vendor, read the first vendor's own manual, even when the manual is a minified JS blob.

**Decoding the range codes (and the trap in it).** We fetched every code and compared sizes, expecting them to grow with the range. They did not. Code 2 returned 68 candles, code 4 only 27, code 5 returned 211, and code 8 returned 2,087. Wrong mental model: the candles are not the same size. 5D uses 30-minute candles, 6M and 1Y and 5Y and Max use *weekly* candles, YTD uses *daily* ones. A 6-month weekly chart has fewer points than a 5-day half-hourly one. The mapping is 2=5D, 4=6M, 5=YTD, 6=1Y, 7=5Y, 8=Max (3 is the 1M we already have). Lesson: decode before you assume. We saved each response as a fixture, so the facts are pinned by tests instead of by memory.

**The transport: `batchexecute`.** The answer is a POST with a form body `f.req=<JSON>`, and it needs three tokens that live in the quote page: `FdrFJe` (session id), `cfb2h` (build label) and `Im6cmf` (URL base). No auth token is required. We now extract those in `extractSession` and hang them on the `Quote`. The response is a peculiar sandwich: a `)]}'` prefix (an old anti-JSON-hijacking trick), then length-prefixed chunks, each a line holding a JSON array like `["wrb.fr","c2u4wc","<a JSON string>", …]`. Yes: **JSON inside a string inside JSON**. You parse twice, like opening a matryoshka doll. We skip the length numbers entirely and just try to parse every line that starts with `[`; garbage lines are ignored.

**Reuse beats rewrite.** Remember the shape-based candle finder, the one that doesn't care about array positions? The decoded payload has the same silhouette as the page's chart blobs, so `parseBatchExecute` just hands it to `findChartCandles` and takes the longest list. A brand new transport, and the parser did not need to learn anything. That is the dividend of searching by shape: it pays out again years later, in places you didn't plan.

**2,087 points is too many.** Max range gives forty years of weekly candles. Drawing 2,087 path points in an SVG that gets base64-encoded into a markdown image is wasteful, and your eye cannot see more than a few hundred anyway. `downsample` picks 400 evenly spaced candles, always keeping the first and the last (otherwise the chart's endpoints, and the percentage change, would lie). Axis labels also adapt to the span: "Mon D" for short ranges, "Nov '25" past six months, a bare year past two years, because "Nov 5" on a 40-year chart tells you nothing.

**The UI.** A "Chart Range" section with eight actions (⌘1 to ⌘8, a checkmark on the active one) plus ⌘T to cycle. `useChart` serves 1D and 1M from the quote with no network, and fetches the rest with the usual abort-on-change pattern and a 5-minute cache. Under the chart a caption shows the change over that range, using yesterday's close as the base for 1D and the first candle otherwise.

**The risk, stated plainly.** This is Google's *undocumented internal API*. The RPC id, the codes, the token names, any of it can change without notice, and nobody will email us. What protects us: failures come back as visible, typed results (never a crash), the fixtures pin the current behaviour in tests, and `scripts/probe-ranges.mjs` plus `scripts/live-check.ts` can be re-run outside the sandbox to see what drifted. Treat the safety net as part of the feature, not an extra.
