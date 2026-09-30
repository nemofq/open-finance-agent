import type { EvidenceId } from "@/lib/evidence/types";
import { CALCULATOR_TOOL } from "@/lib/calculator/tool-name";
import { REPORT_TOOL } from "@/lib/reports/tool-name";
import type { ToolClass } from "@/lib/tools/contracts";
import { disagrees, entriesOf } from "./evidence";
import type { MessagePart } from "./transcript";

/**
 * The deterministic financial tools. The authority is each tool's `ToolMeta.class` on the
 * server, which the browser never receives, so the names are repeated here.
 */
const FINANCE_TOOLS: readonly string[] = [REPORT_TOOL, CALCULATOR_TOOL];

/** What a class is called when no source names the call. */
const CLASS_LABELS: Record<ToolClass, string> = {
  data: "Data connection",
  finance: "Financial tool",
  general: "General tool",
};

/** What the tool card shows beside the tool name. */
export interface ToolBadges {
  /** "SEC EDGAR · tier 1 · as of 2026-08-01" for a data result, else a plain class name. */
  label: string;
  ids: EvidenceId[];
  lookAhead: boolean;
  /** An entry disagrees with another entry (a conflict whose `agree` is false). */
  conflict: boolean;
}

export function toolBadges(part: MessagePart): ToolBadges {
  const entries = entriesOf(part);
  // Only a data connection registers a source, so one entry carrying it settles the class.
  const sourced = entries.find((entry) => entry.source !== undefined);
  const source = sourced?.source;
  const name = part.kind === "tool" ? part.name : "";
  const toolClass: ToolClass = source ? "data" : FINANCE_TOOLS.includes(name) ? "finance" : "general";
  const asOf = sourced?.asOf === undefined ? "" : ` · as of ${sourced.asOf}`;

  return {
    label: source ? `${source.name} · tier ${source.tier}${asOf}` : CLASS_LABELS[toolClass],
    ids: entries.map((entry) => entry.id),
    lookAhead: entries.some((entry) => entry.lookAhead === true),
    conflict: entries.some(disagrees),
  };
}
