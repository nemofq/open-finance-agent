"use client";

import { cn } from "cn";
import { useEffect, useRef } from "react";
import { useColorScheme } from "@/components/shared/use-color-scheme";

/**
 * One TradingView embed. Its script reads the config from its own body and draws into the div
 * beside it, so both are rebuilt whenever the symbol or the theme changes. `fill` takes the
 * height of the parent, as the detail dialog's tabs want; otherwise the widget sizes itself.
 */
function TradingViewWidget({ embed, config, fill }: { embed: string; config: Record<string, unknown>; fill: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const colorTheme = useColorScheme();
  // Serialised, so a config object rebuilt on every render does not rebuild the embed.
  const body = JSON.stringify({ ...config, width: "100%", locale: "en", colorTheme });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.innerHTML = "";
    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    widget.style.width = "100%";
    if (fill) widget.style.height = "calc(100% - 32px)";

    const script = document.createElement("script");
    script.src = `https://s3.tradingview.com/external-embedding/embed-widget-${embed}.js`;
    script.async = true;
    script.innerHTML = body;
    container.append(widget, script);

    return () => {
      container.innerHTML = "";
    };
  }, [embed, body, fill]);

  return (
    <div
      ref={containerRef}
      className={cn("tradingview-widget-container w-full", fill ? "h-full min-h-[420px]" : "min-h-[160px] overflow-hidden")}
    />
  );
}

export function TradingViewChart({ symbol }: { symbol: string }) {
  return (
    <TradingViewWidget
      embed="symbol-overview"
      fill
      config={{
        symbols: [[symbol, `${symbol}|1D`]],
        chartOnly: false,
        height: "100%",
        autosize: true,
        showVolume: true,
        showMA: false,
        hideDateRanges: false,
        hideMarketStatus: false,
        hideSymbolLogo: false,
        scalePosition: "right",
        scaleMode: "Normal",
        fontFamily: "-apple-system, BlinkMacSystemFont, Trebuchet MS, Roboto, Ubuntu, sans-serif",
        fontSize: "10",
        noTimeScale: false,
        valuesTracking: "1",
        changeMode: "price-and-percent",
        chartType: "area",
        headerFontSize: "medium",
        lineWidth: 2,
        lineType: 0,
        dateRanges: ["1d|1", "1m|30", "3m|60", "12m|1D", "60m|1W", "all|1M"],
      }}
    />
  );
}

export function TradingViewTimeline({ symbol }: { symbol: string }) {
  return (
    <TradingViewWidget
      embed="timeline"
      fill
      config={{ feedMode: "symbol", symbol, isTransparent: true, displayMode: "regular", height: "100%" }}
    />
  );
}

export function TradingViewSymbolInfo({ symbol }: { symbol: string }) {
  return <TradingViewWidget embed="symbol-info" fill={false} config={{ symbol, isTransparent: true }} />;
}
