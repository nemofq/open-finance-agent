import { afterAll, describe, expect, it } from "vitest";
import type { EvidenceEntry, EvidenceLedger } from "@/lib/evidence/types";
import { registerToolResult } from "@/lib/evidence/register";
import { shutdownSandbox } from "@/lib/sandbox";
import { useConformanceHome } from "@/lib/sandbox/testing";
import { fixedTimeContext } from "@/lib/time";
import type { ModuleContext } from "@/lib/tools/contracts";
import type { CalculatorDetails } from "./tool";
import { pythonModule } from "./tool";

/**
 * The calculator end to end: the real sandbox, the real ledger contract, the text the model
 * actually reads. Opt-in with `OFA_SANDBOX_TESTS=1`, like the rest of the sandbox suite.
 */

const enabled = process.env.OFA_SANDBOX_TESTS === "1";

const income: EvidenceEntry = {
  id: "E7",
  kind: "E",
  summary: "EDGAR income statement, annual, $NVDA, 2 periods",
  fetchedAt: "2026-09-13T00:00:00.000Z",
  source: { id: "edgar", name: "SEC EDGAR", tier: 1 },
  currency: "USD",
  table: {
    columns: ["metric", "FY2021", "FY2025"],
    rows: [
      ["Revenues", 318.0, 452.3],
      ["NetIncome", 72.9, 110.4],
    ],
    index: "metric",
  },
};

function ledger(entries: EvidenceEntry[]): EvidenceLedger {
  const all = [...entries];
  const counters: Record<string, number> = {};
  return {
    sessionId: "conformance",
    list: (kind) => (kind ? all.filter((entry) => entry.kind === kind) : all),
    get: (id) => all.find((entry) => entry.id === id),
    add: (entry) => {
      counters[entry.kind] = (counters[entry.kind] ?? 0) + 1;
      const created: EvidenceEntry = { ...entry, id: `${entry.kind}${counters[entry.kind]}`, fetchedAt: "2026-09-13T00:00:00.000Z" };
      all.push(created);
      return created;
    },
    savePayload: async () => undefined,
    loadPayload: async <T>() => undefined as T | undefined,
    findFacts: () => [],
    matchValue: () => [],
    flush: async () => undefined,
  };
}

function context(evidence: EvidenceLedger): ModuleContext {
  return { log: () => undefined, session: { id: "conformance" }, evidence };
}

describe.runIf(enabled)("financial_calculator end to end", () => {
  useConformanceHome();
  afterAll(() => shutdownSandbox());

  it("runs the exact table expression advertised beside a human-readable source", async () => {
    const book = ledger([]);
    const registered = await registerToolResult({ ledger: book,
      tool: { name: "edgar_financials", meta: { class: "data", effect: "read",
        source: { id: "edgar", name: "SEC EDGAR", tier: 1, coverage: ["fundamentals"] } } },
      toolCallId: "source-table", args: {}, isError: false, time: fixedTimeContext({ asOf: "2024-07-05" }),
      result: { content: [{ type: "text", text: "Free cash flow: USD 4,872 million" }], details: {
        table: { columns: ["metric", "2023-05-31"], rows: [["freeCashFlow", 4_872_000_000]], index: "metric" },
        unit: "USD",
      } },
    });
    const text = registered.content.map((part) => part.type === "text" ? part.text : "").join("\n");
    const expression = /Example: `([^`]+)` = 4872000000/.exec(text)?.[1];
    expect(expression).toBeDefined();
    const [tool] = await pythonModule.createTools({}, context(book));
    await tool.execute("table-expression", { evidence: [registered.entry!.id],
      code: `emit("Free cash flow", ${expression}, unit="USD")`,
    }, undefined as never);
    expect(book.get("C1")).toMatchObject({ value: 4_872_000_000, unit: "USD", inputs: ["E1"] });
    expect(book.list("A")).toEqual([]);
  }, 300_000);

  it("computes from referenced evidence and records every figure", async () => {
    const book = ledger([income]);
    const tools = await pythonModule.createTools({ timeoutSeconds: 30 }, context(book));
    expect(tools).toHaveLength(1);

    const result = await tools[0].execute(
      "call-1",
      {
        evidence: ["E7"],
        code: [
          'rev = E7.loc["Revenues"]',
          'emit("Revenue CAGR FY21-FY25", fin.cagr(rev["FY2021"], rev["FY2025"], periods=4))',
          'wacc = assume("wacc", 0.092, "CAPM: risk-free from E15, beta 1.1, ERP 4.5%")',
          "hurdle = 0.15",
          'emit("spread over hurdle", wacc - hurdle)',
          'print("done")',
        ].join("\n"),
      },
      undefined as never,
    );

    const text = result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
    // Percentages are recorded the way the model will write them, so P8 can match the figure.
    // The reference token and the rest of the decoration belong to format.test.ts; what this
    // suite owns is that a real sandbox run reaches the model with its unit and its formula.
    const cagrLine = text.split("\n").find((line) => line.startsWith("[C1] "));
    expect(cagrLine).toMatch(/^\[C1\] Revenue CAGR FY21-FY25 = 9\.2\d+%\s/);
    expect(cagrLine).toMatch(/\(.*cagr.*\)$/);
    expect(text).toContain("[A1] wacc = 0.092 — CAPM");
    expect(text).toContain("Output:\ndone");
    expect(text).toContain("[A2] 0.15 on line 4: hurdle = 0.15");

    const details = result.details as CalculatorDetails;
    expect(details.usedEvidence).toEqual(["E7"]);
    expect(details.finVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(details.error).toBeUndefined();
    expect(details.evidence?.map((entry) => entry.id)).toEqual(["C1", "C2", "A1", "A2"]);

    const cagr = book.get("C1");
    expect(cagr).toMatchObject({ kind: "C", unit: "%", inputs: ["E7", "A1", "A2"], finVersion: details.finVersion });
    expect(cagr?.value).toBeCloseTo(((452.3 / 318.0) ** 0.25 - 1) * 100, 10);
    expect(book.get("A2")).toMatchObject({ declared: false, value: 0.15, why: "undeclared constant in calculator code" });
  }, 300_000);

  it("records pandas numeric scalars without requiring manual casts", async () => {
    const book = ledger([{ ...income, table: {
      columns: ["metric", "FY2023"], rows: [["freeCashFlow", 4430]], index: "metric",
    } }]);
    const [tool] = await pythonModule.createTools({}, context(book));
    const result = await tool.execute("numeric-scalars", {
      evidence: ["E7"],
      code: [
        "import numpy as np",
        'fcf = E7.loc["freeCashFlow", "FY2023"]',
        'emit("Free cash flow", fcf, unit="USD M")',
        'emit("Numeric vector", [fcf, np.float32(0.5)])',
        'emit("Labeled values", {"fcf": fcf})',
        'emit("Assumed growth", assume("growth", np.float32(0.5), "scenario input"))',
      ].join("\n"),
    }, undefined as never);
    expect((result.details as CalculatorDetails).error).toBeUndefined();
    expect(book.get("C1")).toMatchObject({ value: 4430, unit: "USD M", inputs: ["E7", "A1"] });
    expect(book.get("C2")?.table?.rows).toEqual([["0", 4430], ["1", 0.5]]);
    expect(book.get("C3")?.table?.rows).toEqual([["fcf", 4430]]);
    expect(book.get("C4")?.value).toBe(0.5);
    expect(book.get("A1")).toMatchObject({ value: 0.5, declared: true, why: "scenario input" });
    expect(book.list("A")).toHaveLength(1);
  }, 300_000);

  it.each(["True", "np.bool_(True)", "np.complex128(1j)", "np.float32('nan')", "np.float64('inf')"])(
    "rejects non-real or non-finite scalar %s", async (value) => {
      const book = ledger([]);
      const [tool] = await pythonModule.createTools({}, context(book));
      await expect(tool.execute("invalid-scalar", {
        code: `import numpy as np\nemit("invalid", ${value})`,
      }, undefined as never)).rejects.toThrow(/expected a number|cannot be recorded as evidence/);
      expect(book.list("C")).toEqual([]);
    }, 300_000,
  );

  it("names the evidence that does exist when an id is unknown", async () => {
    const book = ledger([income]);
    const [tool] = await pythonModule.createTools({}, context(book));
    await expect(
      tool.execute("call-2", { evidence: ["E99"], code: 'emit("x", 1.5)' }, undefined as never),
    ).rejects.toThrow(/E99 is not in the evidence ledger[\s\S]*E7 \(EDGAR income statement/);
  }, 300_000);

  it("runs the advertised quarterly example with source dates, correct comparison direction and percent units", async () => {
    const book = ledger([{ ...income, table: {
      columns: ["metric", "2025-03-29", "2024-12-28", "2024-09-28", "2024-06-29", "2024-03-30"],
      rows: [["revenue", 240, 200, 160, 125, 100], ["grossProfit", 120, 80, 48, 25, 10]],
      index: "metric",
    } }]);
    const [tool] = await pythonModule.createTools({}, context(book));
    const code = /```python\n([\s\S]+?)\n```/.exec(tool.description)?.[1];
    expect(code).toBeDefined();
    const result = await tool.execute("quarterly-example", { evidence: ["E7"], code: code! }, undefined as never);
    expect(result.details).toMatchObject({ usedEvidence: ["E7"], undeclaredConstants: [] });
    expect((result.details as CalculatorDetails).error).toBeUndefined();
    expect(book.list("A")).toEqual([]);
    expect(book.list("C").map((entry) => ({ name: entry.name, unit: entry.unit, inputs: entry.inputs, rows: entry.table?.rows })))
      .toEqual([
        { name: "Gross margin", unit: "%", inputs: ["E7"], rows: [
          ["2024-03-30", 10], ["2024-06-29", 20], ["2024-09-28", 30], ["2024-12-28", 40], ["2025-03-29", 50],
        ] },
        { name: "Revenue QoQ", unit: "%", inputs: ["E7"], rows: [
          ["2024-06-29", 25], ["2024-09-28", expect.closeTo(28)], ["2024-12-28", 25], ["2025-03-29", 20],
        ] },
        { name: "Revenue YoY", unit: "%", inputs: ["E7"], rows: [["2025-03-29", 140]] },
      ]);
  }, 300_000);

  it("answers code that cannot run with one line and records nothing", async () => {
    const book = ledger([income]);
    const [tool] = await pythonModule.createTools({}, context(book));
    const failure = await tool
      .execute("call-4", { code: 'import requests\nemit("x", 1.5)' }, undefined as never)
      .catch((err: unknown) => err);
    const message = failure instanceof Error ? failure.message : `resolved with ${JSON.stringify(failure)}`;
    // One sentence, naming the construct and what is installed instead. No traceback, because
    // nothing ran, and no evidence, because nothing was computed.
    expect(message.split("\n")).toHaveLength(1);
    expect(message).toContain("`import requests` (line 1)");
    expect(message).toContain("no network and no pip");
    expect(message).toContain("statsmodels");
    expect(book.list("C")).toEqual([]);
    expect(book.list("A")).toEqual([]);
  }, 300_000);

  it("turns a calculation that produced nothing into a tool error", async () => {
    const book = ledger([income]);
    const [tool] = await pythonModule.createTools({}, context(book));
    await expect(tool.execute("call-3", { code: 'fin.cagr(100, 200, 0)' }, undefined as never)).rejects.toThrow(
      /periods must be/,
    );
    // Nothing was recorded, so the ledger is untouched.
    expect(book.list("C")).toEqual([]);
  }, 300_000);
});
