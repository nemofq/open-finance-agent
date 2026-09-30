import { Type } from "typebox";
import type { EvidenceDetails, EvidenceEntry } from "@/lib/evidence/types";
import { CALCULATOR_TOOL } from "./tool-name";
import { ensureSandbox, runCalculation } from "@/lib/sandbox";
import type { SandboxEvidence, SandboxResult, SandboxStatus, SandboxUndeclaredConstant } from "@/lib/sandbox/protocol";
import { settingNumber } from "@/lib/tools/config";
import type { FinanceTool, Module, ModuleContext, ToolMeta } from "@/lib/tools/contracts";
import { statusLine, toolDescription } from "./description";
import { recordResults, resolveEvidence } from "./evidence";
import { formatError, formatResult } from "./format";

/**
 * The financial calculator: model-written Python, run in the Pyodide-inside-Deno
 * sandbox, over evidence passed by reference, with every result recorded in the ledger.
 *
 * Fails closed. When the runtime is missing or its isolation check did not pass, `createTools`
 * returns nothing and the tool is never offered to the model.
 */

const DEFAULT_TIMEOUT_SECONDS = 10;
const MIN_TIMEOUT_SECONDS = 1;
const MAX_TIMEOUT_SECONDS = 60;

/** Deterministic computation over data already retrieved: no network, no writes. */
const calculatorMeta: ToolMeta = { class: "finance", effect: "compute" };

const parameters = Type.Object({
  code: Type.String({
    description:
      "Python 3 to run. Reference preloaded evidence frames by id, declare constants with assume(), and record every result with emit().",
  }),
  evidence: Type.Optional(
    Type.Array(Type.String(), {
      description:
        'Evidence ids to preload as pandas DataFrames named after the id, e.g. ["E7", "E12"]. Each frame carries its source metadata on `.attrs`.',
    }),
  ),
});

export interface CalculatorDetails extends EvidenceDetails {
  /** The C and A entries this calculation added, so a reloaded chat rebuilds its ledger. */
  evidence?: EvidenceEntry[];
  code: string;
  stdout: string;
  /** Set when the code failed after emitting something; a failure with nothing emitted throws. */
  error?: string;
  durationMs: number;
  undeclaredConstants: SandboxUndeclaredConstant[];
  usedEvidence: string[];
  finVersion: string;
}

export function resolveTimeoutMs(cfg: Record<string, unknown>): number {
  const seconds = settingNumber(cfg, "timeoutSeconds");
  if (seconds === undefined) return DEFAULT_TIMEOUT_SECONDS * 1000;
  return Math.min(Math.max(seconds, MIN_TIMEOUT_SECONDS), MAX_TIMEOUT_SECONDS) * 1000;
}

function createCalculatorTool(
  timeoutMs: number,
  status: SandboxStatus,
  ctx: ModuleContext,
): FinanceTool<typeof parameters, CalculatorDetails> {
  return {
    name: CALCULATOR_TOOL,
    meta: calculatorMeta,
    label: "Financial calculator",
    description: toolDescription(status),
    parameters,
    async execute(_toolCallId, params) {
      const code = params.code.trim();
      if (!code) throw new Error("financial_calculator needs some code to run.");

      const requested = params.evidence ?? [];
      let evidence: Record<string, SandboxEvidence> = {};
      if (requested.length > 0) {
        evidence = await resolveEvidence(ctx.evidence, requested);
      }

      const result = await runCalculation({ code, evidence, timeoutMs });
      // Nothing to record and nothing to show: the calculation is simply an error.
      if (!result.ok && result.emitted.length === 0) {
        throw new Error(errorText(result));
      }

      const sections = recordResults(ctx.evidence, result);
      return {
        content: [{ type: "text", text: formatResult(result, sections, ctx.evidence) }],
        details: {
          evidence: [...sections.computed, ...sections.assumed, ...sections.undeclared],
          code,
          stdout: result.stdout,
          ...(result.error ? { error: result.error } : {}),
          durationMs: result.durationMs,
          undeclaredConstants: result.undeclaredConstants,
          usedEvidence: result.usedEvidence,
          finVersion: result.finVersion,
        },
      };
    },
  };
}

/** A failed run still shows what it printed: the traceback alone often does not say why. */
function errorText(result: SandboxResult): string {
  const trace = formatError(result.error ?? "the calculation failed");
  return result.stdout.trim() ? `${trace}\n\nOutput before the failure:\n${result.stdout.trimEnd()}` : trace;
}

export const pythonModule: Module = {
  id: "python",
  name: "Financial calculator",
  kind: "financial-tool",
  description:
    "Runs model-written Python over your retrieved data in an isolated runtime with no network, no files and no processes. Preloads the reviewed `fin` formula library and records every computed figure as evidence.",
  settings: [
    {
      key: "timeoutSeconds",
      label: "Timeout (seconds)",
      type: "text",
      required: false,
      help: `How long one calculation may run before it is stopped. ${MIN_TIMEOUT_SECONDS}–${MAX_TIMEOUT_SECONDS}, default ${DEFAULT_TIMEOUT_SECONDS}.`,
    },
  ],
  defaultConfig: {
    enabled: true,
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
  },
  async validate() {
    // Validate is also the Settings button that re-runs the escape probes.
    const status = await ensureSandbox({ recheck: true });
    return { ok: status.state === "ready" && status.isolation === "passed", message: statusLine(status) };
  },
  async createTools(cfg, ctx) {
    const status = await ensureSandbox();
    if (status.state !== "ready" || status.isolation !== "passed") {
      ctx.log(`financial_calculator is not registered: ${statusLine(status)}`);
      return [];
    }
    return [createCalculatorTool(resolveTimeoutMs(cfg), status, ctx)];
  },
};
