import { Action, ActionPanel, Color, Icon, List, LocalStorage } from "@raycast/api";
import { Fragment, useEffect, useState } from "react";
import { buildChartSvg } from "./chart";
import { chartMarkdown } from "./chartImage";
import { compactFor, money, signed, timeAgo } from "./format";
import { FAVORITES_KEY, favKey, parseFavs, toggleFav, type Fav } from "./favorites";
import { googleFinanceSearchUrl, quoteUrl } from "./google";
import { searchStocks, type SearchHit } from "./search";
import type { Quote } from "./types";
import { useQuote, type QuoteState } from "./useQuote";

type Range = "1D" | "1M";

const SEARCH_DEBOUNCE_MS = 200;

function detailMarkdown(q: Quote, range: Range): string {
  const candles = range === "1D" ? q.intraday : q.daily;
  const svg = buildChartSvg(candles, { previousClose: range === "1D" ? q.previousClose : undefined });
  const color = q.change >= 0 ? "🟢" : "🔴";
  const updated = q.updatedAt ? ` · updated ${timeAgo(q.updatedAt)}` : "";
  const head = `# ${q.name} (${q.symbol})\n\n${color} **${money(q.price, q.currency)}**  ${signed(q.change)} (${signed(q.changePercent)}%)${updated}`;
  const chart = chartMarkdown(svg, candles, `${q.symbol}-${range}`);
  const news = q.news.length
    ? q.news.map((n) => `- [${n.title}](${n.url}) — ${n.source} · ${timeAgo(n.publishedAt)}`).join("\n")
    : "_No news found._";
  return `${head}\n\n${chart}\n\n_Range: ${range}_\n\n### News\n\n${news}`;
}

function QuoteDetail({ state, range }: { state: QuoteState | undefined; range: Range }) {
  if (!state || state.status === "loading") return <List.Item.Detail isLoading markdown="Loading quote…" />;
  const result = state.result;
  if (!result.ok) {
    return (
      <List.Item.Detail markdown={`## Quote unavailable\n\n${result.reason}\n\n_Reason: ${result.kind}_`} />
    );
  }
  const q = result.quote;
  const s = q.stats;
  const label = (title: string, text: string | undefined) =>
    text === undefined ? null : <List.Item.Detail.Metadata.Label key={title} title={title} text={text} />;
  const num = (n: number | undefined, f: (n: number) => string) => (n === undefined ? undefined : f(n));
  const price = (n: number) => money(n, q.currency);

  const groups = [
    [
      label("Open", num(s.open, price)),
      label("High", num(s.high, price)),
      label("Low", num(s.low, price)),
      label("Prev Close", money(q.previousClose, q.currency)),
    ],
    [
      label("Market Cap", num(s.marketCap, compactFor(q.currency))),
      label("Volume", num(s.volume, compactFor(q.currency))),
      label("Avg Volume", num(s.avgVolume, compactFor(q.currency))),
    ],
    [
      label("52-Wk High", num(s.yearHigh, price)),
      label("52-Wk Low", num(s.yearLow, price)),
      label("P/E", num(s.peRatio, (n) => n.toFixed(2))),
      label("EPS", num(s.eps, (n) => n.toFixed(2))),
      label("Beta", num(s.beta, (n) => n.toFixed(2))),
    ],
    [
      label("Shares Out", num(s.sharesOutstanding, compactFor(q.currency))),
      label("Employees", num(s.employees, (n) => n.toLocaleString(q.currency === "INR" ? "en-IN" : "en-US"))),
    ],
  ].filter((group) => group.some((item) => item !== null));

  return (
    <List.Item.Detail
      markdown={detailMarkdown(q, range)}
      metadata={
        <List.Item.Detail.Metadata>
          {groups.map((group, i) => (
            <Fragment key={i}>
              {i > 0 && <List.Item.Detail.Metadata.Separator />}
              {group}
            </Fragment>
          ))}
        </List.Item.Detail.Metadata>
      }
    />
  );
}

export default function Command() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string>();
  const [favs, setFavs] = useState<Fav[]>([]);
  const [selected, setSelected] = useState<string>();
  const [range, setRange] = useState<Range>("1D");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    LocalStorage.getItem<string>(FAVORITES_KEY).then((raw) => setFavs(parseFavs(raw)));
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits([]);
      setSearchError(undefined);
      setSearching(false);
      return;
    }
    const abort = new AbortController();
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const result = await searchStocks(q, { signal: abort.signal });
        if (abort.signal.aborted) return;
        setHits(result);
        setSearchError(undefined);
      } catch (error) {
        if (abort.signal.aborted) return;
        setHits([]);
        setSearchError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!abort.signal.aborted) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query]);

  const rows: Fav[] = query.trim()
    ? hits.map((h) => ({ symbol: h.symbol, name: h.name, ...(h.exchange ? { exchange: h.exchange } : {}) }))
    : favs;
  const selectedRow = rows.find((r) => favKey(r) === selected);
  const quoteState = useQuote(selectedRow?.symbol, selectedRow?.exchange, refreshKey);

  useEffect(() => {
    if (rows.length === 0) setSelected(undefined);
  }, [rows.length]);

  const isFav = (row: Fav) => favs.some((f) => favKey(f) === favKey(row));
  const stateFor = (row: Fav) =>
    quoteState?.symbol === row.symbol && quoteState.exchange === (row.exchange ?? "") ? quoteState : undefined;
  const exchangeTag = (exchange: string | undefined): List.Item.Accessory[] =>
    exchange === "NSE" ? [{ tag: "NSE" }] : exchange === "BOM" ? [{ tag: "BSE" }] : [];

  async function toggleFavorite(fav: Fav) {
    const next = toggleFav(favs, fav);
    setFavs(next);
    await LocalStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
  }


  return (
    <List
      isLoading={searching}
      isShowingDetail
      searchBarPlaceholder="Search company or ticker…"
      onSearchTextChange={setQuery}
      onSelectionChange={(id) => setSelected(id ?? undefined)}
      filtering={false}
    >
      {searchError ? (
        <List.EmptyView icon={Icon.ExclamationMark} title="Search failed" description={searchError} />
      ) : rows.length === 0 ? (
        <List.EmptyView
          icon={Icon.MagnifyingGlass}
          title={searching ? "Searching…" : query.trim() ? "No matches" : "Type a company name or ticker"}
          description={query.trim() ? undefined : "Star a result with ⌘⇧F to pin it here."}
        />
      ) : (
        <List.Section title={query.trim() ? "Search Results" : "Favorites"}>
          {rows.map((row) => {
            const rowState = stateFor(row);
            return (
            <List.Item
              key={favKey(row)}
              id={favKey(row)}
              title={row.symbol}
              subtitle={row.name}
              accessories={[
                ...exchangeTag(row.exchange),
                ...(isFav(row) ? [{ icon: { source: Icon.Star, tintColor: Color.Yellow } }] : []),
              ]}
              detail={<QuoteDetail state={rowState} range={range} />}
              actions={
                <ActionPanel>
                  <Action.OpenInBrowser
                    title="Open in Google Finance"
                    url={
                      row.exchange
                        ? quoteUrl(row.symbol, row.exchange)
                        : rowState?.status === "done" && rowState.result.ok
                          ? quoteUrl(row.symbol, rowState.result.quote.exchange)
                          : googleFinanceSearchUrl(row.symbol)
                    }
                  />
                  <Action
                    title={range === "1D" ? "Show 1-Month Chart" : "Show 1-Day Chart"}
                    icon={Icon.LineChart}
                    shortcut={{ modifiers: ["cmd"], key: "t" }}
                    onAction={() => setRange(range === "1D" ? "1M" : "1D")}
                  />
                  <Action
                    title={isFav(row) ? "Remove from Favorites" : "Add to Favorites"}
                    icon={Icon.Star}
                    shortcut={{ modifiers: ["cmd", "shift"], key: "f" }}
                    onAction={() => toggleFavorite(row)}
                  />
                  <Action
                    title="Refresh Quote"
                    icon={Icon.ArrowClockwise}
                    shortcut={{ modifiers: ["cmd"], key: "r" }}
                    onAction={() => setRefreshKey((k) => k + 1)}
                  />
                  {rowState?.status === "done" && rowState.result.ok && (
                    <Action.CopyToClipboard
                      title="Copy Price"
                      content={rowState.result.quote.price.toFixed(2)}
                    />
                  )}
                </ActionPanel>
              }
            />
            );
          })}
        </List.Section>
      )}
    </List>
  );
}
