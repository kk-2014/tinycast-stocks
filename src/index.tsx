import { Action, ActionPanel, Color, Icon, List, LocalStorage } from "@raycast/api";
import { useEffect, useState } from "react";
import { buildChartSvg } from "./chart";
import { chartMarkdown } from "./chartImage";
import { compact, money, signed, timeAgo } from "./format";
import { FAVORITES_KEY, parseFavs, toggleFav, type Fav } from "./favorites";
import { quoteUrl } from "./google";
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

  return (
    <List.Item.Detail
      markdown={detailMarkdown(q, range)}
      metadata={
        <List.Item.Detail.Metadata>
          {label("Open", num(s.open, (n) => money(n, q.currency)))}
          {label("High", num(s.high, (n) => money(n, q.currency)))}
          {label("Low", num(s.low, (n) => money(n, q.currency)))}
          {label("Prev Close", money(q.previousClose, q.currency))}
          <List.Item.Detail.Metadata.Separator />
          {label("Market Cap", num(s.marketCap, compact))}
          {label("Volume", num(s.volume, compact))}
          {label("Avg Volume", num(s.avgVolume, compact))}
          <List.Item.Detail.Metadata.Separator />
          {label("52-Wk High", num(s.yearHigh, (n) => money(n, q.currency)))}
          {label("52-Wk Low", num(s.yearLow, (n) => money(n, q.currency)))}
          {label("P/E", num(s.peRatio, (n) => n.toFixed(2)))}
          {label("EPS", num(s.eps, (n) => n.toFixed(2)))}
          {label("Beta", num(s.beta, (n) => n.toFixed(2)))}
          <List.Item.Detail.Metadata.Separator />
          {label("Shares Out", num(s.sharesOutstanding, compact))}
          {label("Employees", num(s.employees, (n) => n.toLocaleString("en-US")))}
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

  const quoteState = useQuote(selected, refreshKey);

  const rows: Fav[] = query.trim() ? hits.map((h) => ({ symbol: h.symbol, name: h.name })) : favs;
  const isFav = (symbol: string) => favs.some((f) => f.symbol === symbol);

  async function toggleFavorite(fav: Fav) {
    const next = toggleFav(favs, fav);
    setFavs(next);
    await LocalStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
  }

  const exchangeForUrl = quoteState?.status === "done" && quoteState.result.ok ? quoteState.result.quote.exchange : "NASDAQ";

  return (
    <List
      isLoading={searching}
      isShowingDetail
      searchBarPlaceholder="Search company or ticker…"
      onSearchTextChange={setQuery}
      onSelectionChange={(id) => setSelected(id ?? undefined)}
      throttle
    >
      {searchError ? (
        <List.EmptyView icon={Icon.ExclamationMark} title="Search failed" description={searchError} />
      ) : rows.length === 0 ? (
        <List.EmptyView
          icon={Icon.MagnifyingGlass}
          title={query.trim() ? "No matches" : "Type a company name or ticker"}
          description={query.trim() ? undefined : "Star a result with ⌘⇧F to pin it here."}
        />
      ) : (
        <List.Section title={query.trim() ? "Search Results" : "Favorites"}>
          {rows.map((row) => (
            <List.Item
              key={row.symbol}
              id={row.symbol}
              title={row.symbol}
              subtitle={row.name}
              accessories={isFav(row.symbol) ? [{ icon: { source: Icon.Star, tintColor: Color.Yellow } }] : []}
              detail={<QuoteDetail state={quoteState?.symbol === row.symbol ? quoteState : undefined} range={range} />}
              actions={
                <ActionPanel>
                  <Action.OpenInBrowser title="Open in Google Finance" url={quoteUrl(row.symbol, exchangeForUrl)} />
                  <Action
                    title={range === "1D" ? "Show 1-Month Chart" : "Show 1-Day Chart"}
                    icon={Icon.LineChart}
                    shortcut={{ modifiers: ["cmd"], key: "r" }}
                    onAction={() => setRange(range === "1D" ? "1M" : "1D")}
                  />
                  <Action
                    title={isFav(row.symbol) ? "Remove from Favorites" : "Add to Favorites"}
                    icon={Icon.Star}
                    shortcut={{ modifiers: ["cmd", "shift"], key: "f" }}
                    onAction={() => toggleFavorite(row)}
                  />
                  <Action
                    title="Refresh Quote"
                    icon={Icon.ArrowClockwise}
                    shortcut={{ modifiers: ["cmd", "shift"], key: "r" }}
                    onAction={() => setRefreshKey((k) => k + 1)}
                  />
                  {quoteState?.status === "done" && quoteState.result.ok && quoteState.symbol === row.symbol && (
                    <Action.CopyToClipboard
                      title="Copy Price"
                      content={quoteState.result.quote.price.toFixed(2)}
                    />
                  )}
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}
    </List>
  );
}
