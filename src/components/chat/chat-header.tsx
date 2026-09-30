"use client";

import type { ReactNode } from "react";
import { TickerHoverCard } from "@/components/market/ticker-hover-card";

/** Session title, the tickers seen so far, and the way back into a hidden artifact column. */
export function ChatHeader({
  title,
  tickers,
  children,
}: {
  title: string;
  tickers: string[];
  /** Right-hand controls: scheduling, and the reports button while the column is closed. */
  children: ReactNode;
}) {
  return (
    // One bar tall, like the sidebar's brand row and the reports column's header: the row keeps
    // its single line and clips what will not fit rather than growing a second one.
    <header className="h-bar shrink-0 border-b bg-background">
      <div className="mx-auto flex h-full w-full max-w-3xl items-center gap-x-3 overflow-hidden px-4">
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h1>
        {tickers.length > 0 && (
          <div className="flex shrink-0 gap-1 overflow-hidden">
            {tickers.slice(0, 8).map((ticker) => (
              <TickerHoverCard key={ticker} symbol={ticker} />
            ))}
          </div>
        )}
        {children}
      </div>
    </header>
  );
}
