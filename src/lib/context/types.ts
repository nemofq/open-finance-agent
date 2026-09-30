import type { EvidenceId } from "@/lib/evidence/types";

/** Context management: three layers, finance-specific compaction. */

/** A research checkpoint that replaces everything before it in the model's context. */
export interface CompactionMessage {
  role: "compaction";
  /** The validated checkpoint text sent to the model in place of the compacted history. */
  summary: string;
  /** Estimated context tokens before and after the compaction. */
  tokensBefore: number;
  tokensAfter: number;
  /** Ledger entries the checkpoint references, so the UI can link them. */
  evidenceIds: EvidenceId[];
  /** An optional `/compact <focus>` instruction the user gave. */
  focus?: string;
  /** Figures stripped from the summary because no entry held them. */
  stripped?: string[];
  timestamp: number;
}

/** Token budgets derived from the model's window (defaults, no settings). */
export interface ContextBudget {
  /** Provider-reported or user-entered window; 32k when unknown. */
  window: number;
  /** True when the window was assumed rather than known. */
  unknownWindow: boolean;
  /** Largest view a single tool result may take. */
  toolResultMax: number;
  /** Stub old results once the context passes this many tokens. */
  stubAt: number;
  /** Compact once the context passes this many tokens. */
  compactAt: number;
  /** Tokens of recent turns kept in full through a compaction. */
  keepRecent: number;
}

/** What the composer's context meter shows. */
export interface ContextUsage {
  used: number;
  window: number;
  unknownWindow: boolean;
  compactions: number;
}
