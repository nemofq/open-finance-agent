import { describe, expect, it } from "vitest";
import type { EvidenceEntry } from "@/lib/evidence/types";
import type { SandboxResult } from "@/lib/sandbox/protocol";
import { formatError, formatResult, undeclaredWarning } from "./format";

function result(over: Partial<SandboxResult> = {}): SandboxResult {
  return {
    type: "result",
    id: "1",
    ok: true,
    emitted: [],
    assumptions: [],
    undeclaredConstants: [],
    usedEvidence: [],
    stdout: "",
    durationMs: 4,
    finVersion: "1.0.0",
    ...over,
  };
}

function entry(over: Partial<EvidenceEntry>): EvidenceEntry {
  return { id: "C1", kind: "C", summary: "", fetchedAt: "2026-09-13T00:00:00.000Z", ...over };
}

describe("formatResult", () => {
  it("tags every figure so the model can cite it", () => {
    const text = formatResult(
      result({
        emitted: [
          { name: "DCF value per share", value: 142.1, unit: "USD", formula: "pv(fcf, 9.2%) + terminal" },
          { name: "Revenue CAGR", value: 0.124, unit: "%" },
        ],
      }),
      {
        computed: [
          entry({ id: "C3", name: "DCF value per share", formula: "pv(fcf, 9.2%) + terminal" }),
          entry({ id: "C4", name: "Revenue CAGR" }),
        ],
        assumed: [],
        undeclared: [],
      },
    );
    expect(text).toBe(
      ["[C3] DCF value per share = 142.1 USD (report {C3})  (pv(fcf, 9.2%) + terminal)", "[C4] Revenue CAGR = 12.4% (report {C4})"].join("\n"),
    );
  });

  it("lists assumptions with their reason, then the scratch output", () => {
    const text = formatResult(result({ stdout: "checking\n", assumptions: [{ name: "wacc", value: 0.092, why: "CAPM from E15" }] }), {
      computed: [],
      assumed: [entry({ id: "A1", kind: "A", name: "wacc", value: 0.092, why: "CAPM from E15" })],
      undeclared: [],
    });
    expect(text).toBe("[A1] wacc = 0.092 — CAPM from E15\n\nOutput:\nchecking");
  });

  it("warns about undeclared constants after the figures, not instead of them", () => {
    const text = formatResult(
      result({
        emitted: [{ name: "spread", value: 0.067 }],
        undeclaredConstants: [{ value: 0.092, line: 1, snippet: "wacc = 0.092" }],
      }),
      {
        computed: [entry({ id: "C1", name: "spread" })],
        assumed: [],
        undeclared: [entry({ id: "A2", kind: "A", value: 0.092 })],
      },
    );
    expect(text).toContain("[C1] spread = 0.067");
    expect(text).toContain("Undeclared constants (1)");
    expect(text).toContain("[A2] 0.092 on line 1: wacc = 0.092");
    expect(text).toContain("assume(name, value, why)");
  });

  it("reports a failure that happened after some figures were already recorded", () => {
    const text = formatResult(result({ ok: false, error: "ZeroDivisionError: division by zero", emitted: [{ name: "a", value: 1 }] }), {
      computed: [entry({ id: "C1", name: "a" })],
      assumed: [],
      undeclared: [],
    });
    expect(text).toContain("[C1] a = 1");
    expect(text).toContain("The calculation then failed:\nZeroDivisionError: division by zero");
  });

  it("says what was missing when the code emitted nothing", () => {
    expect(formatResult(result(), { computed: [], assumed: [], undeclared: [] })).toContain("emit(name, value, unit)");
  });

  it("shows a short series with its labels and units so it can be cited without another call", () => {
    const text = formatResult(result({ emitted: [{ name: "weights", value: { a: 0.6, b: 0.4 }, unit: "%" }] }), {
      computed: [entry({ id: "C1", name: "weights", table: { columns: ["label", "value"], rows: [["a", 0.6], ["b", 0.4]] } })],
      assumed: [],
      undeclared: [],
    });
    expect(text).toContain('[C1] weights = 2 values: "a": 60% (report {C1:a}); "b": 40% (report {C1:b})');
    expect(text).toContain('evidence_table with source "C1"');
  });

  it("bounds a long series preview while preserving both ends and its retrieval id", () => {
    const value = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`period-${i}`, i]));
    const text = formatResult(result({ emitted: [{ name: "series", value, unit: "USD" }] }), {
      computed: [entry({ id: "C7", name: "series" })], assumed: [], undeclared: [],
    });
    expect(text).toContain('"period-0": 0 USD');
    expect(text).toContain('"period-99": 99 USD');
    expect(text).not.toContain('"period-50"');
    expect(text).toContain("evidence_get C7 for the full series");
    expect(text.length).toBeLessThan(800);
  });
});

describe("undeclaredWarning", () => {
  it("is empty when every constant was declared", () => {
    expect(undeclaredWarning(result(), [])).toBe("");
  });
});

describe("formatError", () => {
  it("keeps the model's frames and drops the sandbox's own", () => {
    const raw = ['  File "<calculation>", line 2, in <module>', '  File "/sandbox/runner.py", line 9', "ValueError: nope"].join("\n");
    expect(formatError(raw)).toBe('  File "<calculation>", line 2, in <module>\nValueError: nope');
  });

  it("returns the original when there would be nothing left", () => {
    expect(formatError("/sandbox/runner.py exploded")).toBe("/sandbox/runner.py exploded");
  });
});
