import { describe, expect, it } from "vitest";
import { ledgerWith } from "@/lib/evidence/testing";
import type { EvidenceEntry, EvidenceId } from "@/lib/evidence/types";
import type { SandboxResult } from "@/lib/sandbox/protocol";
import { displayValue, recordedValue, recordResults, resolveEvidence, UnknownEvidenceError } from "./evidence";

const table = { columns: ["metric", "FY2025"], rows: [["Revenues", 452.3]] as (string | number)[][], index: "metric" };

function entry(over: Partial<EvidenceEntry> = {}): EvidenceEntry {
  return { id: "E7", kind: "E", summary: "EDGAR income statement", fetchedAt: "2026-09-13T00:00:00.000Z", ...over };
}

function sandboxResult(over: Partial<SandboxResult> = {}): SandboxResult {
  return {
    type: "result",
    id: "1",
    ok: true,
    emitted: [],
    assumptions: [],
    undeclaredConstants: [],
    usedEvidence: [],
    stdout: "",
    durationMs: 5,
    finVersion: "1.0.0",
    ...over,
  };
}

describe("recordedValue and displayValue", () => {
  it("stores a percentage the way the model will write it", () => {
    // fin returns 0.124; the answer says "12.4%", and the ledger must match that figure.
    expect(recordedValue(0.124, "%")).toBeCloseTo(12.4, 10);
    expect(displayValue(0.124, "%")).toBe("12.4%");
  });

  it("leaves every other unit alone", () => {
    expect(recordedValue(142.1, "USD")).toBe(142.1);
    expect(displayValue(142.1, "USD")).toBe("142.1 USD");
    expect(displayValue(18.4, "x")).toBe("18.4x");
    expect(displayValue(0.0001234, undefined)).toBe("0.0001234");
  });
});

describe("resolveEvidence", () => {
  it("refuses future-dated inputs before preloading their values", async () => {
    const ledger = ledgerWith([entry({ table, lookAhead: true })]);
    await expect(resolveEvidence(ledger, ["E7"])).rejects.toThrow("unavailable at this turn's cutoff");
  });

  it("preloads an inline table with its source metadata", async () => {
    const ledger = ledgerWith([
      entry({ table, source: { id: "edgar", name: "SEC EDGAR", tier: 1 }, asOf: "2026-08-28", currency: "USD" }),
    ]);
    await expect(resolveEvidence(ledger, ["E7"])).resolves.toEqual({
      E7: {
        columns: table.columns,
        rows: table.rows,
        index: "metric",
        meta: { id: "E7", summary: "EDGAR income statement", source: "SEC EDGAR", asOf: "2026-08-28", currency: "USD" },
      },
    });
  });

  it("falls back to the stored payload when the table is not inline", async () => {
    const ledger = ledgerWith([entry({ hasPayload: true })]);
    await ledger.savePayload("E7", { table });
    const resolved = await resolveEvidence(ledger, ["E7"]);
    expect(resolved.E7.rows).toEqual(table.rows);
  });

  it("preloads figures from source prose with their units and context, without assumptions", async () => {
    const ledger = ledgerWith([entry({ numbers: [
      { value: 1_500_000_000, unit: "USD", context: "Net income was $1.5 billion, up 45 percent." },
      { value: 45, unit: "%", context: "Net income was $1.5 billion, up 45 percent." },
    ] })]);
    const { E7 } = await resolveEvidence(ledger, ["E7"]);
    expect(E7.columns).toEqual(["value", "unit", "context"]);
    expect(E7.rows.map((row) => row.slice(0, 2))).toEqual([[1_500_000_000, "USD"], [45, "%"]]);
    expect(E7.rows.every((row) => row[2] === "Net income was $1.5 billion, up 45 percent.")).toBe(true);
    expect(E7.meta.id).toBe("E7");
    expect(ledger.list("A")).toEqual([]);
  });

  it("names what does exist when an id is unknown", async () => {
    const ledger = ledgerWith([entry({ table })]);
    await expect(resolveEvidence(ledger, ["E99"])).rejects.toThrow(UnknownEvidenceError);
    await expect(resolveEvidence(ledger, ["E99"])).rejects.toThrow(/E7 \(EDGAR income statement\)/);
  });

  it.each(["C", "A", "U"] as const)("preloads a scalar %s entry without inventing another assumption", async (kind) => {
    const id = `${kind}1` as EvidenceId;
    const ledger = ledgerWith([entry({ id, kind, summary: "Monthly amount", value: 12, unit: "USD" })]);
    const resolved = await resolveEvidence(ledger, [id]);
    expect(resolved[id]).toMatchObject({ columns: ["value", "unit", "context"], rows: [[12, "USD", "Monthly amount"]], meta: { id, unit: "USD" } });
  });

  it("explains when an entry holds no numeric data", async () => {
    const ledger = ledgerWith([entry({ summary: "Empty result" })]);
    await expect(resolveEvidence(ledger, ["E7"])).rejects.toThrow(/holds no numeric data/);
  });
});

describe("recordResults", () => {
  it("records a C entry per figure, with its formula, unit and inputs", () => {
    const ledger = ledgerWith([entry({ table })]);
    const result = sandboxResult({
      usedEvidence: ["E7"],
      emitted: [{ name: "Revenue CAGR", value: 0.124, unit: "%", formula: "cagr = (452.3/318.0)^(1/4) - 1" }],
    });
    const { computed } = recordResults(ledger, result);
    expect(computed).toHaveLength(1);
    expect(computed[0]).toMatchObject({
      id: "C1",
      kind: "C",
      name: "Revenue CAGR",
      unit: "%",
      formula: "cagr = (452.3/318.0)^(1/4) - 1",
      inputs: ["E7"],
      finVersion: "1.0.0",
    });
    expect(computed[0].value).toBeCloseTo(12.4, 10);
    expect(computed[0].summary).toBe("Revenue CAGR = 12.4% (calculated)");
  });

  it("stores a vector as a table on the C entry", () => {
    const ledger = ledgerWith([]);
    const { computed } = recordResults(
      ledger,
      sandboxResult({ emitted: [{ name: "weights", value: { AAPL: 0.6, MSFT: 0.4 } }] }),
    );
    expect(computed[0].value).toBeUndefined();
    expect(computed[0].table).toEqual({
      columns: ["label", "value"],
      rows: [
        ["AAPL", 0.6],
        ["MSFT", 0.4],
      ],
      index: "label",
    });
  });

  it("marks declared assumptions and undeclared constants apart (rule P6)", () => {
    const ledger = ledgerWith([]);
    const { assumed, undeclared } = recordResults(
      ledger,
      sandboxResult({
        assumptions: [{ name: "wacc", value: 0.092, why: "CAPM from E15" }],
        undeclaredConstants: [{ value: 0.025, line: 3, snippet: "g = 0.025" }],
      }),
    );
    expect(assumed[0]).toMatchObject({ kind: "A", name: "wacc", value: 0.092, declared: true, why: "CAPM from E15" });
    expect(undeclared[0]).toMatchObject({
      kind: "A",
      name: "g = 0.025",
      value: 0.025,
      declared: false,
      why: "undeclared constant in calculator code",
    });
    expect(undeclared[0].summary).toContain("line 3");
  });
});
