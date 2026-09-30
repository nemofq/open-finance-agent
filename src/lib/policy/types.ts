import type { EvidenceId } from "@/lib/evidence/types";

/**
 * The enforcement engine: one balanced policy, no user-facing strictness.
 * Rules are pure functions of an event, the ledger and session state that return a verdict.
 */
export type RuleId =
  | "P1" // trusted sources first
  | "P2" // duplicate data call
  | "P3" // personal data leaving
  | "P4" // stale quote
  | "P5" // sources disagree
  | "P6" // undeclared calculator constants
  | "P8" // unsourced figures in the answer
  | "P9" // key figure backed only by tier 4
  | "P11" // recommendation wording
  | "P12" // profile exclusions and experience
  | "P13" // look-ahead evidence
  | "delivery"
  | "H1"; // harness recovery: one last tool-free request after a cut-short, interrupted or malformed run

export type VerdictKind =
  | "block"
  | "annotate"
  | "serve"
  | "follow_up"
  | "flag";

export type CheckStage = "before_tool" | "after_tool" | "before_model" | "before_stop" | "report" | "calculator";

/** `observe` records what every rule would do without blocking, correcting or flagging. */
export type PolicyMode = "enforce" | "observe";

export interface Verdict {
  rule: RuleId;
  kind: VerdictKind;
  /** One sentence the model, the user or a developer can act on. */
  reason: string;
  /**
   * Text that goes with the verdict: the block reason returned to the model, the annotation
   * prepended to a result, the follow-up prompt, or the served evidence.
   */
  text?: string;
  /** Figures the verdict concerns, as they appeared. */
  figures?: string[];
  /** Ledger entries the verdict concerns. */
  evidence?: EvidenceId[];
  /** For a block: the tools it asks for first. Once any was attempted this turn, it only annotates. */
  requires?: string[];
}

/** A verdict as recorded on the transcript, the answer footer and the benchmark metrics. */
export interface CheckRecord extends Verdict {
  id: string;
  timestamp: number;
  stage: CheckStage;
  toolCallId?: string;
  tool?: string;
  mode: PolicyMode;
  /** Whether the verdict took effect (false in observe mode, or when a budget was spent). */
  enforced: boolean;
  /** A replacement answered this correction; keep the audit, not its instruction in model context. */
  resolved?: boolean;
}

/** A before-tool verdict that took effect: the call does not run, and the model reads the reason. */
export interface Block {
  block: true;
  reason: string;
}

/** A custom transcript message holding one check; only `follow_up` checks reach the model. */
export interface CheckMessage {
  role: "check";
  check: CheckRecord;
  timestamp: number;
}

/* ------------------------------------------------------------ engine state */

/** A disagreement the ledger recorded, kept so the before-stop check can ask for it to be mentioned. */
export interface ConflictNote {
  /** The entry the disagreement was found on. */
  entry: EvidenceId;
  /** The entry it disagrees with. */
  with: EvidenceId;
  metric: string;
  period: string;
  value: number;
  otherValue: number;
}

/**
 * What the policy concern (`src/lib/harness/policy.ts`) tracks for one run besides the turn's own
 * fields. Rules read it; only that concern changes it, so every rule stays a pure function of
 * `(event, context)`.
 */
export interface PolicyState {
  /** Data connections tried per company (ticker upper-case, `*` for none) in this chat: ticker -> source ids. */
  connectionsTried: Map<string, Set<string>>;
  /** Source ids that errored or returned nothing for a company, which lifts P1's block. */
  connectionsFailed: Map<string, Set<string>>;
  /** Disagreements seen this run, for the before-stop half of P5. */
  conflicts: ConflictNote[];
  /** Tools let through this turn, whatever they returned. */
  attempted: Set<string>;
}

/**
 * The counts under an answer: the ledger's composition plus what the checks found.
 * Built by `summarizeChecks`.
 */
export interface AnswerFooter {
  /** E + C + A + U entries; R stubs are references, not figures. */
  figures: number;
  retrieved: number;
  computed: number;
  assumed: number;
  userProvided: number;
  /** Distinct figures the final answer showed with no entry behind them (P8). */
  unsourced: number;
  /** Entries holding a disagreement with another entry. */
  conflicts: number;
  /** Distinct figures backed only by tier 4 sources (P9). */
  unverified: number;
  flags: CheckRecord[];
  /** Tool calls stopped by a block. */
  blocks: number;
  /** Duplicate calls answered from the ledger instead (P2). */
  served: number;
  /** Follow-ups actually sent. */
  followUps: number;
}
