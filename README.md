# Tinycast Stocks

Search US and Indian (NSE/BSE) stocks from your launcher and see a quote, key stats, a price chart
(1D, 5D, 1M, 6M, YTD, 1Y, 5Y, Max) and company news, powered by Google Finance.

A [Raycast](https://www.raycast.com/)-compatible extension, built for and tested in
[Tinycast](https://github.com/abue-ammar/tinycast).

## How it works

Typing searches by company name or ticker (via stockanalysis.com). Highlighting a result fetches the
Google Finance page for it and parses the structured `AF_initDataCallback` data blobs *by shape*, not by
CSS class, so cosmetic page changes do not break it. Longer chart ranges use Google's own
`batchexecute` request. Every failure (network, blocked, layout changed) shows a visible message.

For the full story, including the bugs we hit and what they taught us, read [`kambaldhage.md`](kambaldhage.md).

## Keys

| Key | Action |
|---|---|
| ⌘1 … ⌘8 | Chart range: 1D, 5D, 1M, 6M, YTD, 1Y, 5Y, Max |
| ⌘T | Next range |
| ⌘R | Refresh quote |
| ⌘⇧F | Add/remove favorite |

## Build and install

```sh
npm install
npm test            # unit tests against saved fixtures
npx ray build       # builds into ~/.config/raycast/extensions/tinycast-stocks
```

Then import the extension in Tinycast. `npm run live-check` fetches live pages and reports if Google's
layout drifted. The saved pages in `test/fixtures/` are trimmed to their data scripts only.

## Disclaimer

Unofficial and not affiliated with Google, Raycast or Tinycast. It reads public web pages and
undocumented endpoints that can change or be rate-limited at any time. Quotes may be delayed and are
not financial advice. Use it for personal, low-volume lookups and respect the terms of the sites it
reads.

## License

MIT
