/** Formats date and market session strings for the system prompt and per-turn context. */
import { isTradingDay } from "./calendar";
import type { MarketClock, MarketSession, TimeContext } from "./types";

const SESSION_LABEL: Record<MarketSession, string> = {
  pre_market: "pre-market",
  open: "open",
  after_hours: "after-hours",
  closed: "closed",
};

const ISO_INSTANT = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/;

function describeMarket(market: MarketClock): string {
  const label = SESSION_LABEL[market.session];
  if (market.reason === "weekend") return `${label} (weekend)`;
  if (market.reason === "holiday") return market.holiday ? `${label} (${market.holiday})` : label;
  if (market.reason === "early_close") {
    return market.holiday ? `${label} (closed early, ${market.holiday})` : `${label} (closed early)`;
  }
  return market.earlyClose ? `${label}, closes early at 13:00 ET` : label;
}

function shortInstant(iso: string): string {
  const match = ISO_INSTANT.exec(iso);
  return match ? `${match[1]} ${match[2]} ET` : iso;
}

/** The per-turn note. Short by design: it changes every turn and must never enter the prompt. */
export function formatTimeNote(time: TimeContext): string {
  const { market } = time;
  if (time.mode === "fixed") {
    const asOf = time.asOf ?? time.localDate;
    const standing = isTradingDay(asOf) ? "after the close" : "market closed";
    return `As-of date ${asOf} (${standing}). Last completed session ${market.lastCompletedSession}.`;
  }

  const local = time.localTime ? `${time.localDate} ${time.localTime}` : time.localDate;
  const newYork = market.newYorkDate && market.newYorkTime
    ? `${market.newYorkDate} ${market.newYorkTime}`
    : undefined;
  // The parenthetical only earns its words when the user is not already on New York time.
  const here = newYork && newYork !== local
    ? `Current time: ${local} ${time.timeZone} (${newYork} New York).`
    : `Current time: ${local} ${time.timeZone}.`;

  return `${here} US market: ${describeMarket(market)}; last completed session ${market.lastCompletedSession}; next open ${shortInstant(market.nextOpen)}.`;
}
