import { describe, expect, it } from "vitest";
import type { AfterToolEvent } from "../events";
import { financeTool, testContext } from "../testing";
import { p6UndeclaredConstants } from "./calculator-assumptions";

function calculatorResult(details: unknown, toolName = "financial_calculator"): AfterToolEvent {
  return {
    stage: "after_tool",
    toolName,
    toolCallId: "call_1",
    args: { code: "emit('fv', 100 * 1.07)" },
    tool: financeTool(toolName),
    isError: false,
    text: "fv = 107",
    details,
  };
}

describe("P6 undeclared calculator constants", () => {
  it("records the constants the calculator found undeclared", () => {
    const details = { undeclaredConstants: [{ value: 1.07, line: 1, snippet: "100 * 1.07" }] };
    const verdict = p6UndeclaredConstants(calculatorResult(details), testContext());

    expect(verdict?.kind).toBe("annotate");
    expect(verdict?.figures).toEqual(["1.07"]);
    // The calculator already warned in its own result, so nothing is prepended.
    expect(verdict?.text).toBeUndefined();
  });

  it("says nothing when every constant was declared", () => {
    expect(p6UndeclaredConstants(calculatorResult({ undeclaredConstants: [] }), testContext())).toBeUndefined();
  });

  it("says nothing for another tool", () => {
    const details = { undeclaredConstants: [{ value: 1.07, line: 1, snippet: "100 * 1.07" }] };

    expect(p6UndeclaredConstants(calculatorResult(details, "create_report"), testContext())).toBeUndefined();
  });

  it("copes with details of another shape", () => {
    expect(p6UndeclaredConstants(calculatorResult("plain text"), testContext())).toBeUndefined();
  });
});
