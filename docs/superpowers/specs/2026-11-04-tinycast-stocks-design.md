# Tinycast Stocks — Design

## Goal
A Raycast-compatible extension for Tinycast that, as you type a company name or ticker, shows a quote with details, a price chart, and news, sourced from Google Finance only.

## Why a new extension
The installed `google-finance` extension scrapes `data-last-price` and the `mfs7Fc`/`P6K39c` CSS classes. Google's page no longer contains them, so every quote parse returns null and rows stay on "Loading quote…" with no error state. Verified against a real response (saved as the first fixture).

## Verified facts about the Google Finance page
`https://www.google.com/finance/quote/<SYMBOL>:<EXCHANGE>` returns HTML containing `AF_initDataCallback({key: 'ds:N', ...data: <JSON>})` blobs:
- Live quote: `[price, change, changePct, ...]` plus a timestamp (e.g. `[326.21,-5.60,-1.69,2,2,2],[1793731514]`), in the `ds:2`/`ds:13` blobs.
- Candles: 5-minute intraday and daily series, `[open, close, high, low, "ISO time", volume]` (blobs `ds:9`–`ds:12`).
- Stats (open/high/low, market cap, volume, P/E, dividend, 52-week range, EPS, beta), quarterly financials (`ds:14`), analyst targets (`ds:6`).
- News with title, source and URL (`ds:15`/`ds:16`). These may mix in related tickers; filter to the symbol where possible.
Blob numbering is not guaranteed stable, so the parser locates blobs by shape, not by key.

Tinycast imports extensions built with `ray build` from `~/.config/raycast/extensions`, and ships its own Raycast runtime shim, so `@raycast/api` support may be partial.

## Architecture
```
src/
  index.tsx          List + Detail view, actions, favorites
  search.ts          name -> tickers via stockanalysis.com/api/search
  google.ts          fetch page for SYMBOL:EXCHANGE, exchange probing + cache
  parse.ts           PURE: html -> Quote | ParseError (no I/O)
  chart.ts           PURE: candles -> SVG string
  cache.ts           LocalStorage wrapper, ~60s TTL
test/
  fixtures/          saved Google pages
  parse.test.ts      vitest against fixtures
scripts/
  live-check.ts      fetches live page, runs parser, reports layout drift
```

## Data flow
1. Typing triggers a throttled search; rows show symbol and name only (no per-row quote fetch).
2. Highlighting a row triggers one detail fetch. `google.ts` tries NASDAQ, NYSE, NYSEARCA, NYSEAMERICAN, BATS, then others, sequentially, and caches the exchange that works per symbol.
3. `parse.ts` extracts blobs, validates shape, returns a typed `Quote` (price, change, stats, candles by range, news) or a `ParseError` with a reason.
4. The detail pane renders the header, stats, chart and news. Range actions switch the chart.

## Error handling
- Every failure maps to a visible state: network error, HTTP 403/429 (rate limited), consent/redirect page, layout changed (shape validation failed). No silent `continue`.
- Rate-limit friendly: one detail fetch per highlight, 60-second cache, abort in-flight fetches when the selection changes.

## Chart
SVG generated from candle data, embedded in the detail pane markdown. **Spike first:** confirm Tinycast renders it. Fallbacks, in order: PNG written to a temp file, then a text sparkline.

## Testing
- `parse.test.ts` against saved fixtures (assert price, change, stats, candle count, news items).
- `live-check.ts` run manually or weekly to detect Google layout drift.

## Out of scope (v1)
Real-time streaming, watchlist sync, non-US exchange coverage beyond what search returns.

## Risks
- Google can change blob structure or block scripted requests (mitigation: shape-based parsing, visible errors, fixtures).
- Tinycast's runtime shim may not support some `@raycast/api` components (mitigation: spike before building the full UI).
