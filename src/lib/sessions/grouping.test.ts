import { describe, expect, it } from "vitest";
import { dateGroupOf, filterSessions, groupByDate, groupByTicker } from "./grouping";
import type { SessionHeader } from "./types";

function makeSession(id: string, title: string, updatedAt: string, tickers: string[] = []): SessionHeader {
  return {
    id,
    title,
    createdAt: updatedAt,
    updatedAt,
    model: { provider: "openrouter", model: "anthropic/claude-3.5-sonnet" },
    tickers,
    messageCount: 2,
    reports: [],
    running: false,
  };
}

describe("grouping utilities", () => {
  const now = new Date("2026-09-13T12:00:00.000Z");

  describe("dateGroupOf and groupByDate", () => {
    it("categorizes sessions into Today, Yesterday, and Earlier", () => {
      const todaySession = makeSession("1", "Today chat", "2026-09-13T09:00:00.000Z");
      const yesterdaySession = makeSession("2", "Yesterday chat", "2026-09-12T14:00:00.000Z");
      const earlierSession = makeSession("3", "Earlier chat", "2026-09-10T10:00:00.000Z");

      expect(dateGroupOf(todaySession.updatedAt, now)).toBe("Today");
      expect(dateGroupOf(yesterdaySession.updatedAt, now)).toBe("Yesterday");
      expect(dateGroupOf(earlierSession.updatedAt, now)).toBe("Earlier");

      const grouped = groupByDate([todaySession, yesterdaySession, earlierSession], now);
      expect(grouped).toHaveLength(3);
      expect(grouped[0].group).toBe("Today");
      expect(grouped[0].sessions).toEqual([todaySession]);
      expect(grouped[1].group).toBe("Yesterday");
      expect(grouped[1].sessions).toEqual([yesterdaySession]);
      expect(grouped[2].group).toBe("Earlier");
      expect(grouped[2].sessions).toEqual([earlierSession]);
    });

    it("filters out empty date groups", () => {
      const todaySession = makeSession("1", "Today chat", "2026-09-13T09:00:00.000Z");
      const grouped = groupByDate([todaySession], now);
      expect(grouped).toHaveLength(1);
      expect(grouped[0].group).toBe("Today");
    });
  });

  describe("groupByTicker", () => {
    it("groups sessions by ticker and separates general sessions", () => {
      const s1 = makeSession("1", "NVDA earnings", "2026-09-13T10:00:00Z", ["NVDA"]);
      const s2 = makeSession("2", "Chip comparison", "2026-09-13T09:00:00Z", ["NVDA", "AMD"]);
      const s3 = makeSession("3", "Apple valuation", "2026-09-12T15:00:00Z", ["AAPL"]);
      const s4 = makeSession("4", "Macro rates outlook", "2026-09-13T11:00:00Z", []);

      const { tickers, general } = groupByTicker([s1, s2, s3, s4]);

      // General has s4
      expect(general).toEqual([s4]);

      // Ticker groups: NVDA, AMD, AAPL
      // Order of tickers: NVDA latest updatedAt is 10:00, AMD latest is 09:00, AAPL latest is 09-12
      expect(tickers.map((t) => t.ticker)).toEqual(["NVDA", "AMD", "AAPL"]);

      // s2 appears in both NVDA and AMD groups
      const nvdaGroup = tickers.find((t) => t.ticker === "NVDA");
      expect(nvdaGroup?.sessions.map((s) => s.id)).toEqual(["1", "2"]);

      const amdGroup = tickers.find((t) => t.ticker === "AMD");
      expect(amdGroup?.sessions.map((s) => s.id)).toEqual(["2"]);

      const aaplGroup = tickers.find((t) => t.ticker === "AAPL");
      expect(aaplGroup?.sessions.map((s) => s.id)).toEqual(["3"]);
    });

    it("handles all general sessions when no tickers exist", () => {
      const s1 = makeSession("1", "General 1", "2026-09-13T10:00:00Z", []);
      const s2 = makeSession("2", "General 2", "2026-09-13T11:00:00Z", []);

      const { tickers, general } = groupByTicker([s1, s2]);
      expect(tickers).toEqual([]);
      expect(general.map((s) => s.id)).toEqual(["2", "1"]);
    });
  });

  describe("filterSessions", () => {
    const s1 = makeSession("1", "NVDA Q3 earnings review", "2026-09-13T10:00:00Z", ["NVDA"]);
    const s2 = makeSession("2", "Apple hardware margin", "2026-09-13T09:00:00Z", ["AAPL"]);
    const s3 = makeSession("3", "Federal reserve rate cuts", "2026-09-13T08:00:00Z", []);
    const all = [s1, s2, s3];

    it("returns all sessions when query is empty", () => {
      expect(filterSessions(all, "")).toEqual(all);
      expect(filterSessions(all, "   ")).toEqual(all);
    });

    it("matches by title case-insensitively", () => {
      expect(filterSessions(all, "reserve")).toEqual([s3]);
      expect(filterSessions(all, "MARGIN")).toEqual([s2]);
    });

    it("matches by ticker symbol with or without $ prefix", () => {
      expect(filterSessions(all, "NVDA")).toEqual([s1]);
      expect(filterSessions(all, "$NVDA")).toEqual([s1]);
      expect(filterSessions(all, "$aapl")).toEqual([s2]);
    });
  });
});
