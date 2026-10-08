import { describe, expect, it } from "vitest";
import type { EvidenceEntry, EvidenceTable } from "@/lib/evidence/types";
import { resolveContextBudget } from "./budget";
import { entry, fakeModel } from "./testing";
import { textTokens } from "./tokens";
import type { ContextBudget } from "./types";
import { compactToolResult } from "./views";

const budgetOf = (toolResultMax: number): ContextBudget => ({
  ...resolveContextBudget(fakeModel(32_768)),
  toolResultMax,
});

const text = (blocks: ReturnType<typeof compactToolResult>): string =>
  blocks.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");

const view = (body: string, budget: ContextBudget, evidence?: EvidenceEntry) =>
  text(compactToolResult([{ type: "text", text: body }], { budget, entry: evidence }));

const TAG = "[E12 · Alpha Vantage · tier 2 · as of 2026-09-11]";

function priceTable(rows: number): EvidenceTable {
  return {
    columns: ["date", "open", "close"],
    index: "date",
    rows: Array.from({ length: rows }, (_, i) => {
      const day = String((i % 28) + 1).padStart(2, "0");
      const month = String(Math.floor(i / 28) + 1).padStart(2, "0");
      return [`2026-${month}-${day}`, 100 + i, 100.5 + i];
    }),
  };
}

describe("compactToolResult", () => {
  it("leaves a result that already fits alone", () => {
    const content = [{ type: "text" as const, text: "Revenue was $30,040M." }];
    expect(compactToolResult(content, { budget: budgetOf(2_000) })).toBe(content);
  });

  it("shrinks a price series to stats, the recent rows and where the rest lives", () => {
    const table = priceTable(60);
    const body = table.rows.map((row) => row.join(",")).join("\n");
    const out = view(`${TAG}\n${body}`, budgetOf(200), entry("E12", { table, summary: "$NVDA daily prices" }));

    expect(out.startsWith(TAG)).toBe(true);
    expect(out).toContain("$NVDA daily prices — 60 rows, 2026-01-01 → 2026-03-04.");
    expect(out).toContain("close: last 159.5 (2026-03-04), min 100.5 (2026-01-01), max 159.5 (2026-03-04).");
    expect(out).toContain("full series in E12 (evidence_get)");
    expect(out).toContain("2026-03-04 | 159 | 159.5");
    // The oldest rows are the ones dropped.
    expect(out).not.toContain("2026-01-01 | 100 |");
    expect(textTokens(out)).toBeLessThanOrEqual(200);
  });

  it("drops the oldest of the recent rows, never the latest, when even they do not all fit", () => {
    const table = priceTable(60);
    const body = table.rows.map((row) => row.join(",")).join("\n");
    const out = view(`${TAG}\n${body}`, budgetOf(120), entry("E12", { table, summary: "$NVDA daily prices" }));
    const shown = Number(/Most recent (\d+) rows:/.exec(out)?.[1]);

    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(20);
    expect(out).toContain("2026-03-04 | 159 | 159.5");
    // The first of the twenty recent rows is the first to go.
    expect(out).not.toContain("2026-02-13 | 140 |");
    expect(textTokens(out)).toBeLessThanOrEqual(120);
  });

  it("keeps the cross-check lines under the tag, not just the tag", () => {
    const header = `${TAG}\nCONFLICT: revenue FY26 Q2 — E3 reports $30.0B vs $31.0B here`;
    const out = view(`${header}\n\n${"filler ".repeat(300)}`, budgetOf(80), entry("E12"));

    expect(out.startsWith(header)).toBe(true);
    expect(out).toContain("(truncated; evidence_get E12 for the rest)");
  });

  it("gives a filing its first pages and an index of its sections", () => {
    const body = [
      "PART I",
      "Item 1. Business",
      "We design accelerated computing platforms. ".repeat(20),
      "Item 1A. Risk Factors",
      "Demand may not materialise. ".repeat(20),
      "Item 7. Management's Discussion and Analysis",
      "Revenue rose. ".repeat(20),
    ].join("\n");
    const out = view(`${TAG}\n${body}`, budgetOf(150), entry("E7"));

    expect(out.startsWith(TAG)).toBe(true);
    expect(out).toContain("We design accelerated computing platforms.");
    expect(out).toContain("Sections: PART I; Item 1. Business; Item 1A. Risk Factors");
    expect(out).toContain("(truncated; evidence_get E7 for the rest)");
    expect(textTokens(out)).toBeLessThanOrEqual(150);
  });

  it("renders a vendor table head and says how many rows there are", () => {
    const table: EvidenceTable = {
      columns: ["period", "revenue", "eps"],
      index: "period",
      rows: Array.from({ length: 40 }, (_, i) => [`FY${2000 + i}`, 1000 + i, 1.5 + i]),
    };
    const body = JSON.stringify(table.rows);
    const out = view(body, budgetOf(100), entry("E3", { table, summary: "EDGAR income statement" }));

    expect(out).toContain("EDGAR income statement — 40 rows × 3 columns.");
    expect(out).toContain("period | revenue | eps");
    expect(out).toContain("FY2000 | 1000 | 1.5");
    expect(out).toContain("(40 rows total; evidence_get E3 for the rest)");
    expect(textTokens(out)).toBeLessThanOrEqual(100);
  });

  it("keeps the head and the tail of anything else", () => {
    const body = `START ${"filler ".repeat(200)} END`;
    const out = view(body, budgetOf(60), entry("E9"));

    expect(out.startsWith("START")).toBe(true);
    expect(out.trimEnd().endsWith("END")).toBe(true);
    expect(out).toContain("… (truncated; evidence_get E9 for the rest) …");
    expect(textTokens(out)).toBeLessThanOrEqual(60);
  });

  it("points nowhere rather than at a made-up id when the result has no entry", () => {
    const out = view("x ".repeat(500), budgetOf(60));
    expect(out).toContain("(truncated)");
    expect(out).not.toContain("evidence_get");
  });
});
