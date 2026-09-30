import type { SandboxUndeclaredConstant } from "@/lib/sandbox/protocol";
import { CALCULATOR_TOOL } from "@/lib/calculator/tool-name";
import type { AfterToolRule } from "../events";

/**
 * P6 — undeclared calculator constants. The calculator runs anyway and warns in its own result;
 * this rule keeps the record so the footer and the benchmark can count it.
 */

function undeclaredConstants(details: unknown): SandboxUndeclaredConstant[] {
  if (typeof details !== "object" || details === null) return [];
  const value = (details as { undeclaredConstants?: unknown }).undeclaredConstants;
  return Array.isArray(value) ? (value as SandboxUndeclaredConstant[]) : [];
}

export const p6UndeclaredConstants: AfterToolRule = (event) => {
  if (event.toolName !== CALCULATOR_TOOL) return undefined;

  const constants = undeclaredConstants(event.details);
  if (constants.length === 0) return undefined;

  const shown = constants.map((constant) => String(constant.value));
  return {
    rule: "P6",
    kind: "annotate",
    reason: `The calculation used ${constants.length} constant${constants.length === 1 ? "" : "s"} that came from neither the evidence nor assume(): ${shown.join(", ")}.`,
    figures: shown,
  };
};
