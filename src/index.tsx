import { Action, ActionPanel, Color, Icon, List, LocalStorage } from "@raycast/api";
import { Fragment, useEffect, useState } from "react";
import { buildChartSvg, rangeChange } from "./chart";
import { chartMarkdown } from "./chartImage";
import { compactFor, money, signed, timeAgo } from "./format";
import { FAVORITES_KEY, favKey, parseFavs, toggleFav, type Fav } from "./favorites";
import { insightsMarkdown } from "./insights";
import { marketStatus } from "./market";
import { googleFinanceSearchUrl, quoteUrl } from "./google";
import { searchStocks, type SearchHit } from "./search";
import { RANGES, type RangeId } from "./ranges";
import type { Quote } from "./types";
import { useChart, type ChartState } from "./useChart";
import { useFavoriteQuotes } from "./useFavoriteQuotes";
import { useQuote, type QuoteState } from "./useQuote";

const SEARCH_DEBOUNCE_MS = 200;

function detailMarkdown(q: Quote, range: RangeId, chart: ChartState): string {
  const rangeLabel = RANGES.find((r) => r.id === range)?.label ?? range;
  const color = q.change >= 0 ? "🟢" : "🔴";
  const updated = q.updatedAt ? ` · updated ${timeAgo(q.updatedAt)}` : "";
  const status = marketStatus(q.marketHours, Date.now());
  const statusIcon = status?.state === "open" ? "🟢" : status?.state === "opens-later" ? "🟡" : "⚪";
  const statusLine = status ? `\n\n${statusIcon} ${status.label}` : "";
  const head = `# ${q.name} (${q.symbol})\n\n${color} **${money(q.price, q.currency)}**  ${signed(q.change)} (${signed(q.changePercent)}%)${updated}${statusLine}`;
  let chartBlock: string;
  let caption = "";
  if (chart.loading) {
    chartBlock = `_Loading ${rangeLabel} chart…_`;
  } else if (chart.error !== undefined || !chart.candles) {
    chartBlock = `_Chart unavailable: ${chart.error ?? "no data"}_`;
  } else {
    const svg = buildChartSvg(chart.candles, { previousClose: range === "1D" ? q.previousClose : undefined });
    chartBlock = chartMarkdown(svg, chart.candles, `${q.symbol}-${range}`);
    const change = rangeChange(chart.candles, range === "1D" ? q.previousClose : undefined);
    if (change) caption = `\n\n_${rangeLabel}: ${signed(change.abs)} (${signed(change.pct)}%)_`;
  }
  const news = q.news.length
    ? q.news.map((n) => `- [${n.title}](${n.url}) — ${n.source} · ${timeAgo(n.publishedAt)}`).join("\n")
    : "_No news found._";
  const insights = insightsMarkdown(q);
  return `${head}\n\n${chartBlock}${caption}\n\n${insights ? `${insights}\n\n` : ""}### News\n\n${news}`;
}

function QuoteDetail({ state, range }: { state: QuoteState | undefined; range: RangeId }) {
  const quote = state?.status === "done" && state.result.ok ? state.result.quote : undefined;
  const chart = useChart(quote, range);
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
      label("Dividend Yield", num(s.dividendYield, (n) => `${n.toFixed(2)}%`)),
    ],
    [
      label("Shares Out", num(s.sharesOutstanding, compactFor(q.currency))),
      label("Employees", num(s.employees, (n) => n.toLocaleString(q.currency === "INR" ? "en-IN" : "en-US"))),
    ],
  ].filter((group) => group.some((item) => item !== null));

  return (
    <List.Item.Detail
      markdown={detailMarkdown(q, range, chart)}
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
  const [range, setRange] = useState<RangeId>("1D");
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
  const showingFavorites = !query.trim();
  const favQuotes = useFavoriteQuotes(showingFavorites ? favs : [], refreshKey);
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

  const priceAccessories = (row: Fav): List.Item.Accessory[] => {
    if (!showingFavorites) return [];
    const result = favQuotes.get(favKey(row));
    if (!result) return [{ text: "…" }];
    if (!result.ok) return [{ icon: Icon.ExclamationMark, tooltip: result.reason }];
    const q = result.quote;
    const color = q.changePercent >= 0 ? Color.Green : Color.Red;
    return [
      { text: money(q.price, q.currency) },
      { text: { value: `${signed(q.changePercent)}%`, color } },
    ];
  };

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
      searchText={query}
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
                ...priceAccessories(row),
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
                  <ActionPanel.Section title="Chart Range">
                    {RANGES.map((r, i) => (
                      <Action
                        key={r.id}
                        title={`${r.id === range ? "✓ " : ""}${r.label}`}
                        icon={Icon.LineChart}
                        shortcut={{ modifiers: ["cmd"], key: String(i + 1) as "1" }}
                        onAction={() => setRange(r.id)}
                      />
                    ))}
                  </ActionPanel.Section>
                  <Action
                    title="Next Range"
                    icon={Icon.ArrowRight}
                    shortcut={{ modifiers: ["cmd"], key: "t" }}
                    onAction={() => setRange(RANGES[(RANGES.findIndex((r) => r.id === range) + 1) % RANGES.length].id)}
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
                  {favKey(row) === selected && rowState?.status === "done" && rowState.result.ok && rowState.result.quote.peers.length > 0 && (
                    <ActionPanel.Section title="Peers">
                      {rowState.result.quote.peers.map((p) => (
                        <Action
                          key={`${p.exchange}:${p.symbol}`}
                          title={`Go to ${p.symbol} · ${p.name}`}
                          icon={Icon.ArrowRight}
                          onAction={() => setQuery(p.symbol)}
                        />
                      ))}
                    </ActionPanel.Section>
                  )}
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
