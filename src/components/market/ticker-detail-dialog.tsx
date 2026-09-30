"use client";

import { ExternalLinkIcon, MessageSquarePlusIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TickerSnapshot } from "@/lib/tickers/types";
import { cn } from "cn";
import { useComposerInsert } from "@/components/shared/composer-context";
import { gainClass } from "@/components/shared/format";
import { formatPrice, formatQuoteChange } from "./quote-format";
import { TradingViewChart, TradingViewTimeline } from "./tradingview-widget";

interface TickerDetailDialogProps {
  symbol: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot?: TickerSnapshot;
}

export function TickerDetailDialog({
  symbol,
  open,
  onOpenChange,
  snapshot,
}: TickerDetailDialogProps) {
  const [activeTab, setActiveTab] = useState<string>("chart");
  const insert = useComposerInsert();

  const quote = snapshot?.quote;
  const filingsUrl =
    snapshot?.links.filings ??
    `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(symbol)}&type=&dateb=&owner=include&count=40`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl w-[95vw] h-[720px] max-h-[92vh] flex flex-col p-6 overflow-hidden gap-4">
        <DialogHeader className="gap-1.5 pb-2 border-b border-border">
          <div className="flex flex-wrap items-center justify-between gap-3 pr-8">
            <div className="flex items-baseline gap-3">
              <DialogTitle className="text-xl font-bold font-mono tracking-tight">
                ${symbol}
              </DialogTitle>
              {snapshot?.name && (
                <span className="text-sm font-medium text-muted-foreground truncate max-w-sm">
                  {snapshot.name}
                </span>
              )}
              {snapshot?.cik && (
                <span className="text-xs font-mono text-muted-foreground">
                  CIK {snapshot.cik}
                </span>
              )}
            </div>

            {quote && (
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-semibold tabular-nums font-mono">
                  ${formatPrice(quote.price)}
                </span>
                <span
                  className={cn(
                    "text-xs font-medium tabular-nums px-1.5 py-0.5 rounded bg-muted",
                    gainClass(quote.change),
                  )}
                >
                  {formatQuoteChange(quote, "$")}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-4 text-xs pt-1">
            <DialogDescription className="text-xs text-muted-foreground">
              Real-time interactive chart and market intelligence powered by TradingView.
            </DialogDescription>
            <div className="flex items-center gap-3 ml-auto">
              <a
                href={filingsUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                <span>SEC Filings</span>
                <ExternalLinkIcon className="size-3" />
              </a>
              {insert && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs gap-1"
                  onClick={() => {
                    insert(`$${symbol}`);
                    onOpenChange(false);
                  }}
                >
                  <MessageSquarePlusIcon className="size-3" />
                  Ask in Chat
                </Button>
              )}
            </div>
          </div>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(val) => setActiveTab(val as string)}
          className="flex-1 flex flex-col min-h-0 overflow-hidden"
        >
          <TabsList className="w-fit mb-2">
            <TabsTrigger value="chart" className="gap-1.5">
              <span>📈 Chart</span>
            </TabsTrigger>
            <TabsTrigger value="news" className="gap-1.5">
              <span>📰 News</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="chart" className="flex-1 h-full min-h-0 overflow-hidden mt-0">
            {open && <TradingViewChart symbol={symbol} />}
          </TabsContent>

          <TabsContent value="news" className="flex-1 h-full min-h-0 overflow-hidden mt-0">
            {open && <TradingViewTimeline symbol={symbol} />}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
