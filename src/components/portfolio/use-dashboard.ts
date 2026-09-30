"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { todayIsoDate } from "@/components/shared/format";
import { getJson } from "@/components/shared/http-client";
import { useLoader } from "@/components/shared/use-json";
import { valuationNotice } from "@/lib/portfolio/scope";
import { DEFAULT_PORTFOLIO_CURRENCY, type Account } from "@/lib/portfolio/types";
import type { PortfolioValuation, ValuedAccountCash, ValuedAccountHolding } from "@/lib/portfolio/valuation";
import type { SessionHeader } from "@/lib/sessions/types";

type AccountsResponse = { accounts: Account[] };
type HoldingsResponse = {
  asOf: string;
  holdings: ValuedAccountHolding[];
  valuation: PortfolioValuation;
  quoteError?: string;
};
type SessionsResponse = { sessions: SessionHeader[] };
type DashboardData = {
  accountData: AccountsResponse;
  holdingData: HoldingsResponse;
  sessionData: SessionsResponse;
  loadedAt: Date;
};

/** How often the page re-marks the portfolio while it is on screen. */
const POLL_MS = 30_000;

async function readDashboard(refresh = false): Promise<DashboardData> {
  const currentUrl = `/api/portfolio/current?today=${todayIsoDate()}${refresh ? "&refresh=true" : ""}`;
  const [accountData, holdingData, sessionData] = await Promise.all([
    getJson<AccountsResponse>("/api/portfolio/accounts"),
    getJson<HoldingsResponse>(currentUrl),
    getJson<SessionsResponse>("/api/sessions"),
  ]);
  return { accountData, holdingData, sessionData, loadedAt: new Date() };
}

export interface Dashboard {
  accounts: Account[];
  holdings: ValuedAccountHolding[];
  /** Cash balances with their value in the valuation currency. */
  cash: ValuedAccountCash[];
  asOf: string;
  valuationCurrency: string;
  /** Chats, for the asset dialog's related conversations. */
  sessions: SessionHeader[];
  loading: boolean;
  /** A refresh with fresh quotes is in flight. */
  refreshing: boolean;
  lastUpdated: Date | null;
  error: string;
  /** Report an action's failure; it shows until the next load lands. */
  setError: (error: string) => void;
  /** The last action's confirmation, then any valuation caveat from the latest load. */
  notice: string;
  /** Confirm an action; it stays through reloads until the next call replaces it. */
  setNotice: (notice: string) => void;
  /** Read everything again; `refreshQuotes` asks the server for fresh prices rather than cached ones. */
  reload: (refreshQuotes?: boolean) => Promise<void>;
}

/**
 * The portfolio page's data: accounts, holdings marked to market, cash and the chats that mention
 * them. Loaded on mount, re-read every 30 seconds while the tab is visible, and on demand. A poll
 * that answers after a price refresh started is dropped, and none starts while one runs, so a poll
 * cannot undo a price refresh.
 */
export function useDashboard(): Dashboard {
  const { data, error, reload: read } = useLoader("portfolio", () => readDashboard(), { intervalMs: POLL_MS });
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState("");
  /** An action's failure, with the data shown when it failed: a newer load retires it. */
  const [failure, setFailure] = useState<{ message: string; data: DashboardData | null } | null>(null);
  // The latest data rather than a render's: a poll may land while the failing request runs.
  const shown = useRef(data);
  useEffect(() => {
    shown.current = data;
  });
  const setError = useCallback((message: string) => setFailure({ message, data: shown.current }), []);

  const reload = useCallback(
    async (refreshQuotes = false) => {
      if (!refreshQuotes) return read();
      setRefreshing(true);
      try {
        await read(() => readDashboard(true));
      } finally {
        setRefreshing(false);
      }
    },
    [read],
  );

  const holdingData = data?.holdingData;
  return {
    accounts: data?.accountData.accounts ?? [],
    holdings: holdingData?.holdings ?? [],
    cash: holdingData?.valuation.cash ?? [],
    asOf: holdingData?.asOf ?? "",
    valuationCurrency: holdingData?.valuation.currency ?? DEFAULT_PORTFOLIO_CURRENCY,
    sessions: data?.sessionData.sessions ?? [],
    loading: data === null && error === null,
    refreshing,
    lastUpdated: data?.loadedAt ?? null,
    error: (failure?.data === data ? failure.message : null) ?? error ?? "",
    setError,
    notice: [notice, holdingData ? valuationNotice(holdingData.valuation, holdingData.quoteError) : ""]
      .filter(Boolean)
      .join(" "),
    setNotice,
    reload,
  };
}
