import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { extractFigures, matchFigures } from "@/lib/evidence/figures";
import { createLedger } from "@/lib/evidence/ledger";
import type { EvidenceEntry, EvidenceLedger, FigureMatch } from "@/lib/evidence/types";
import { replayEvidence } from "@/lib/harness/evidence";
import { evidenceTable } from "@/lib/reports/evidence-table";
import { cellFigure } from "@/lib/reports/format";
import { rewriteReferences } from "@/lib/reports/references";
import type { ReportBlock, ReportCell } from "@/lib/reports/spec";
import { specSurfaces } from "@/lib/reports/validate";
import { deliveredReportSpecs } from "./report-content";
import type { ToolCallTrace } from "../types";

/**
 * The benchmark's only door into the evidence ledger. Everything downstream — the
 * checks, the metrics and the judge prompt — works on the plain entries and figure matches this
 * module produces, so those parts stay testable without a ledger.
 */

export interface EvidenceAnalysis {
  entries: EvidenceEntry[];
  figureMatches: FigureMatch[];
  /** Figures in the delivered reports (successful `create_report` calls), matched the same way. */
  reportFigureMatches: FigureMatch[];
  /** A ledger was rebuilt, so the evidence-based checks apply. */
  available: boolean;
}

export interface AnalyseEvidenceInput {
  sessionId: string;
  /** Root of the run's temporary data folder; the ledger reads payloads under it. */
  dataDir: string;
  /** The session transcript, so the ledger is rebuilt exactly as reloading the chat would. */
  messages: AgentMessage[];
  /** Entries the task's turns registered (`TurnResult.evidence`). */
  reported: EvidenceEntry[];
  /** The agent's final answer, whose figures are matched against the ledger. */
  finalText: string;
  /** The run's tool calls; the delivered reports' figures are matched too. */
  toolCalls?: ToolCallTrace[];
}

/** The table as the report showed it; one `create_report` could not build shows nothing here. */
function builtTable(block: Extract<ReportBlock, { type: "evidence_table" }>, ledger: EvidenceLedger): ReportBlock {
  try { return evidenceTable(block, ledger); }
  catch { return block; }
}

/** A digit-free stand-in for a resolved reference, so only literal figures are left in the prose. */
const REFERENCE_PLACEHOLDER = "\u25aa";

/**
 * Every figure a delivered report shows, attributed to ledger entries by value exactly as the
 * chat answer's figures are. A numeric cell is one figure; a `{C3}` or `{E7:metric:period}`
 * reference in prose is the figure it prints; any literal left in the prose goes through the
 * same extraction and exemptions as the answer. Without a ledger nothing matches, and an
 * evidence table, which is built from the ledger, shows nothing.
 */
function matchReportFigures(toolCalls: ToolCallTrace[], ledger?: EvidenceLedger): FigureMatch[] {
  const matches: FigureMatch[] = [];
  for (const spec of deliveredReportSpecs(toolCalls)) {
    if (ledger) {
      for (const section of spec.sections) section.blocks = section.blocks.map((block) => block.type === "evidence_table" ? builtTable(block, ledger) : block);
    }
    const cells: ReportCell[] = [];
    const prose = specSurfaces(spec, (cell) => cells.push(cell)).map((surface) => surface.text);
    for (const cell of cells) {
      if (typeof cell.value !== "number") continue;
      const figure = cellFigure(cell.value, cell.unit);
      matches.push({ figure, matches: ledger ? ledger.matchValue(figure) : [] });
    }
    for (const text of prose) {
      if (!ledger) {
        matches.push(...extractFigures(text).map((figure) => ({ figure, matches: [] })));
        continue;
      }
      const rewritten = rewriteReferences(text, ledger, {
        reference: (reference) => {
          const figure = { ...cellFigure(reference.value, reference.unit), raw: reference.text };
          matches.push({ figure, matches: ledger.matchValue(figure) });
          return REFERENCE_PLACEHOLDER;
        },
        unresolved: () => REFERENCE_PLACEHOLDER,
      });
      matches.push(...matchFigures(rewritten.text, ledger));
    }
  }
  return matches;
}

/**
 * Rebuild the run's ledger and match every figure in the answer against it. A run that registered
 * no evidence leaves `available` false, and the checks use their no-ledger fallbacks.
 */
export async function analyseEvidence(input: AnalyseEvidenceInput): Promise<EvidenceAnalysis> {
  const entries = input.reported;
  if (entries.length === 0) {
    // Nothing to match against; still report the figures the answer contains.
    return {
      entries,
      figureMatches: extractFigures(input.finalText).map((figure) => ({ figure, matches: [] })),
      reportFigureMatches: matchReportFigures(input.toolCalls ?? []),
      available: false,
    };
  }

  const ledger = createLedger({ sessionId: input.sessionId, dataDir: input.dataDir, messages: input.messages });
  // A user message carries no `details`, so the rebuild cannot restore the figures the user typed
  // or the documents they attached; the app's own replay registers both, in the same order and so
  // with the same ids. Several task prompts quote a number ("crashed over 50%"), and an answer
  // repeating one is sourced, not invented.
  const merged = new Map(entries.map((entry) => [entry.id, entry]));
  for (const entry of await replayEvidence(input.sessionId, ledger, input.messages)) {
    if (!merged.has(entry.id)) merged.set(entry.id, entry);
  }

  return {
    entries: [...merged.values()],
    figureMatches: matchFigures(input.finalText, ledger),
    reportFigureMatches: matchReportFigures(input.toolCalls ?? [], ledger),
    available: true,
  };
}
