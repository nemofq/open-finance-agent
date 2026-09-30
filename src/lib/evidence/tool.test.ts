import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EvidenceLedger } from "@/lib/evidence/types";
import type { FinanceTool, ModuleContext } from "@/lib/tools/contracts";
import { createLedger } from "./ledger";
import { evidenceModule, isEvidenceRead, parseRowSpec } from "./tool";

let home: string;
let ledger: EvidenceLedger;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-evidence-get-"));
  ledger = createLedger({ sessionId: "chat-1", dataDir: home });
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function context(evidence: EvidenceLedger): ModuleContext {
  return { log: () => {}, session: { id: "chat-1" }, evidence };
}

async function tool(evidence: EvidenceLedger): Promise<FinanceTool> {
  const [created] = await evidenceModule.createTools({}, context(evidence));
  return created;
}

async function runWith(evidence: EvidenceLedger, params: Record<string, unknown>): Promise<string> {
  const result = await (await tool(evidence)).execute("call-1", params);
  return result.content[0].type === "text" ? result.content[0].text : "";
}

const run = (params: Record<string, unknown>): Promise<string> => runWith(ledger, params);

function priceSeries(): void {
  ledger.add({
    kind: "E",
    summary: "Alpha Vantage TIME_SERIES_DAILY, $NVDA",
    source: { id: "alphavantage", name: "Alpha Vantage", tier: 2 },
    asOf: "2024-08-28",
    table: {
      columns: ["date", "open", "close"],
      rows: [
        ["2024-08-28", 127, 125.61],
        ["2024-08-27", 129, 128.3],
        ["2024-08-26", 130, 126.46],
      ],
      index: "date",
    },
  });
}

describe("evidence_get", () => {
  it("keeps a future source out of subsequent evidence reads", async () => {
    const source = ledger.add({ kind: "E", summary: "Future announcement", value: 42, lookAhead: true });
    const derived = ledger.add({ kind: "C", summary: "Derived", value: 21, inputs: [source.id] });
    for (const id of [source.id, derived.id]) await expect(run({ id })).rejects.toThrow("unavailable at this turn's cutoff");
  });

  it("names the ids it does hold when the entry is unknown", async () => {
    ledger.add({ kind: "E", summary: "EDGAR" });
    await expect(run({ id: "E9" })).rejects.toThrow(/No evidence entry E9. This chat holds: E1\./);
    await expect(runWith(createLedger({ sessionId: "x", dataDir: home }), { id: "C1" })).rejects.toThrow(
      /no evidence yet/,
    );
  });

  it("returns a table slice with the entry's tag above it", async () => {
    priceSeries();
    const text = await run({ id: "e1" });
    expect(text).toContain("[E1 · Alpha Vantage · tier 2 · as of 2024-08-28 · table 3×3]");
    expect(text).toContain("3 of 3 rows");
    expect(text).toContain("| 2024-08-28 | 127 | 125.61 |");
  });

  it("escapes a cell whose pipe or line break would otherwise split the table", async () => {
    ledger.add({ kind: "E", summary: "Segments", table: { columns: ["segment | region", "note"], rows: [["Cloud | US", "new\nline"], ["Other", null]] } });
    const text = await run({ id: "E1" });
    expect(text).toContain("| segment \\| region | note |");
    expect(text).toContain("| Cloud \\| US | new line |");
    expect(text).toContain("| Other | — |");
  });

  it("cuts the table down by rows and columns", async () => {
    priceSeries();
    const text = await run({ id: "E1", rows: "2-3", columns: ["close"] });
    expect(text).toContain("| date | close |");
    expect(text).toContain("| 2024-08-27 | 128.3 |");
    expect(text).not.toContain("2024-08-28 |");
    // The index column is kept even when it was not asked for.
    expect(text).toContain("2 of 3 rows");
  });

  it("keeps the rows a query matches", async () => {
    priceSeries();
    const text = await run({ id: "E1", query: "2024-08-26" });
    expect(text).toContain("1 of 3 rows");
    expect(text).toContain("126.46");
  });

  it("lists the facts of a fact entry", async () => {
    ledger.add({
      kind: "E",
      summary: "EDGAR income statement",
      facts: [
        { metric: "revenue", period: "2024-07-28", value: 30_040_000_000, unit: "USD", ref: "0001045810-24-000029" },
        { metric: "netIncome", period: "2024-07-28", value: 16_599_000_000, unit: "USD" },
      ],
    });
    const text = await run({ id: "E1", query: "revenue" });
    expect(text).toContain("1 fact");
    expect(text).toContain("- revenue 2024-07-28: 30040000000 USD (0001045810-24-000029)");
    expect(text).not.toContain("netIncome");
  });

  it("returns the passages of a stored text payload", async () => {
    const entry = ledger.add({ kind: "E", summary: "10-Q", source: { id: "edgar", name: "SEC EDGAR", tier: 1 } });
    await ledger.savePayload(entry.id, {
      content: [
        {
          type: "text",
          text: `${"filler ".repeat(400)}\nGross margin was 75.1% in the quarter.\n${"more filler ".repeat(400)}`,
        },
      ],
    });
    await ledger.flush();
    const passages = await run({ id: "E1", query: "gross margin" });
    expect(passages).toContain("Gross margin was 75.1%");
    // Located in the document, as edgar_read_filing and read_attachment locate theirs.
    expect(passages).toMatch(/\[chunk \d+\/\d+\]/);
    expect(passages).not.toContain("more filler");
    expect(await run({ id: "E1" })).toContain("filler");
  });

  it("says so when no passage of a stored text matches, rather than returning the first ones", async () => {
    ledger.add({ kind: "E", summary: "Page", source: { id: "web", name: "Web", tier: 4 } });
    await ledger.savePayload("E1", { content: [{ type: "text", text: `${"filler ".repeat(400)}\n${"more filler ".repeat(400)}` }] });
    await ledger.flush();
    expect(await run({ id: "E1", query: "gross margin" })).toMatch(/No passage in this document .* mentions "gross margin"/);
  });

  it("falls back to the numbers it extracted when there is no payload", async () => {
    ledger.add({
      kind: "E",
      summary: "Web search",
      numbers: [{ value: 3.72, unit: "%", context: "10-Year Treasury Yield: ~3.72%" }],
    });
    expect(await run({ id: "E1" })).toContain("10-Year Treasury Yield");
  });

  it("is a general read tool", async () => {
    const created = await tool(ledger);
    expect(created.name).toBe("evidence_get");
    expect(created.meta).toEqual({ class: "general", effect: "read" });
    expect(evidenceModule.kind).toBe("tool");
  });
});

describe("isEvidenceRead", () => {
  it("recognises a read of an entry, and nothing else", async () => {
    priceSeries();
    const read = await (await tool(ledger)).execute("call-1", { id: "E1" });

    expect(isEvidenceRead(read.details)).toBe(true);
    expect(read.details).toEqual({ id: "E1", kind: "E", from: "table" });
    // Written when a turn could run without a ledger; saved chats still hold it.
    expect(isEvidenceRead({ id: "E1", kind: "", from: "missing" })).toBe(false);
    expect(isEvidenceRead({ evidence: [] })).toBe(false);
    expect(isEvidenceRead(undefined)).toBe(false);
  });
});

describe("parseRowSpec", () => {
  it("reads ranges, lists and a mix of both, one-based", () => {
    expect(parseRowSpec("2-4", 10)).toEqual([1, 2, 3]);
    expect(parseRowSpec("1,5,9", 10)).toEqual([0, 4, 8]);
    expect(parseRowSpec("1-2,5", 10)).toEqual([0, 1, 4]);
    expect(parseRowSpec("3", 10)).toEqual([2]);
  });

  it("defaults to the first 50 rows and drops anything out of range", () => {
    expect(parseRowSpec(undefined, 3)).toEqual([0, 1, 2]);
    expect(parseRowSpec("", 80)).toHaveLength(50);
    expect(parseRowSpec("9-12", 10)).toEqual([8, 9]);
    expect(parseRowSpec("0,-3,abc", 10)).toEqual([]);
  });
});
