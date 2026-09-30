"use client";

import { ArrowUpRightIcon, LineChartIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatCalendarDate, gainClass } from "@/components/shared/format";
import { getJson } from "@/components/shared/http-client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import type { TickerSnapshot } from "@/lib/tickers/types";
import { TickerPositionSummary } from "@/components/portfolio/ticker-position-summary";
import { cn } from "cn";
import { errorMessage } from "@/lib/utils";
import { useComposerInsert } from "@/components/shared/composer-context";
import { formatPrice, formatQuoteChange, formatVolume } from "./quote-format";
import { TickerDetailDialog } from "./ticker-detail-dialog";
import { TradingViewSymbolInfo } from "./tradingview-widget";

const TRIGGER_CLASS =
  "rounded border border-border bg-muted/50 px-1 font-mono text-[0.85em] text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring cursor-pointer";

/** One in-flight or resolved request per symbol, shared by every chip on the page. */
const snapshots = new Map<string, Promise<TickerSnapshot>>();

function loadSnapshot(symbol: string): Promise<TickerSnapshot> {
  const cached = snapshots.get(symbol);
  if (cached) return cached;

  const pending = getJson<TickerSnapshot>(`/api/tickers/${encodeURIComponent(symbol)}/snapshot`).catch((err: unknown) => {
    snapshots.delete(symbol); // a failed lookup must not be cached forever
    throw err;
  });

  snapshots.set(symbol, pending);
  return pending;
}

type SnapshotState =
  | { status: "loading" }
  | { status: "ready"; snapshot: TickerSnapshot }
  | { status: "error"; message: string };

/** Fetches once, the first time the card opens. */
function useSnapshot(symbol: string, open: boolean): SnapshotState {
  const [state, setState] = useState<SnapshotState>({ status: "loading" });
  const requested = useRef(false);

  useEffect(() => {
    if (!open || requested.current) return;
    requested.current = true;
    let active = true;
    loadSnapshot(symbol)
      .then((snapshot) => active && setState({ status: "ready", snapshot }))
      .catch((err: unknown) => active && setState({ status: "error", message: errorMessage(err) }));
    return () => {
      active = false;
    };
  }, [open, symbol]);

  return state;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{children}</span>
    </div>
  );
}

function Quote({ snapshot, symbol }: { snapshot: TickerSnapshot; symbol: string }) {
  const { quote } = snapshot;
  if (!quote) {
    return <TradingViewSymbolInfo symbol={symbol} />;
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2">
        <span className="text-base font-medium tabular-nums">{formatPrice(quote.price)}</span>
        <span className={cn("text-xs tabular-nums", gainClass(quote.change))}>{formatQuoteChange(quote)}</span>
      </div>
      {quote.volume !== undefined && <Row label="Volume">{formatVolume(quote.volume)}</Row>}
      <Row label="As of">{formatCalendarDate(quote.asOf)}</Row>
    </div>
  );
}

function CardBody({
  symbol,
  state,
  onOpenDetail,
}: {
  symbol: string;
  state: SnapshotState;
  onOpenDetail: () => void;
}) {
  const insert = useComposerInsert();

  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-5 w-24" />
      </div>
    );
  }

  const chartButton = (
    <Button
      variant="secondary"
      size="sm"
      className="w-full text-xs h-7 gap-1.5 font-medium mt-1"
      onClick={onOpenDetail}
    >
      <LineChartIcon className="size-3.5 text-primary" />
      Chart & News
    </Button>
  );

  if (state.status === "error") {
    return (
      <div className="flex flex-col gap-2">
        <TradingViewSymbolInfo symbol={symbol} />
        {chartButton}
      </div>
    );
  }

  const { snapshot } = state;
  return (
    <div className="flex flex-col gap-2">
      <div>
        <p className="leading-snug font-medium">{snapshot.name ?? `$${symbol}`}</p>
        <p className="font-mono text-xs text-muted-foreground">
          ${symbol}
          {snapshot.cik && ` · CIK ${snapshot.cik}`}
        </p>
      </div>

      <Quote snapshot={snapshot} symbol={symbol} />

      {chartButton}

      <div className="flex items-center gap-3 border-t border-border pt-2 text-xs">
        <a
          href={snapshot.links.filings}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-0.5 hover:underline"
        >
          Filings
          <ArrowUpRightIcon className="size-3" />
        </a>
        {insert && (
          <button type="button" className="hover:underline" onClick={() => insert(`$${symbol}`)}>
            Ask about ${symbol}
          </button>
        )}
      </div>
    </div>
  );
}

/** `$TICKER` chip with a lazily fetched snapshot card on hover, and full TradingView modal on click. */
export function TickerHoverCard({ symbol }: { symbol: string }) {
  const [open, setOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const state = useSnapshot(symbol, open || detailOpen);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          data-ticker={symbol}
          aria-label={`${symbol} snapshot`}
          className={TRIGGER_CLASS}
          openOnHover
          delay={120}
          closeDelay={120}
          onClick={(e) => {
            e.preventDefault();
            setOpen(false);
            setDetailOpen(true);
          }}
        >
          ${symbol}
        </PopoverTrigger>
        <PopoverContent side="top" className="w-80 gap-0">
          <CardBody
            symbol={symbol}
            state={state}
            onOpenDetail={() => {
              setOpen(false);
              setDetailOpen(true);
            }}
          />
          <TickerPositionSummary symbol={symbol} open={open} />
        </PopoverContent>
      </Popover>

      <TickerDetailDialog
        symbol={symbol}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        snapshot={state.status === "ready" ? state.snapshot : undefined}
      />
    </>
  );
}
