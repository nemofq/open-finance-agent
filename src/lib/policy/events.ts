import type { EvidenceEntry, EvidenceLedger } from "@/lib/evidence/types";
import type { PrivacySummary } from "@/lib/portfolio/privacy";
import type { InvestorProfile } from "@/lib/profile/types";
import type { TimeContext } from "@/lib/time/types";
import type { FinanceTool } from "@/lib/tools/contracts";
import type { CheckRecord, PolicyState, Verdict } from "./types";

/**
 * What a rule sees. Every rule is `(event, context) => Verdict | undefined`: a pure function of
 * the event, the ledger and the run's state.
 */

interface ToolEvent {
  toolName: string;
  toolCallId: string;
  args: unknown;
  /** The registered tool, when the call names one the agent knows. */
  tool?: FinanceTool;
}

export interface BeforeToolEvent extends ToolEvent {
  stage: "before_tool";
}

export interface AfterToolEvent extends ToolEvent {
  stage: "after_tool";
  /** The entry the evidence track registered for this result, when it made one. */
  entry?: EvidenceEntry;
  isError: boolean;
  /** The result text as the model will see it, after the evidence track's own rewrite. */
  text: string;
  details: unknown;
}

export interface BeforeStopEvent {
  stage: "before_stop";
  /** The completed assistant message the agent would stop on. */
  text: string;
  /** The request being answered: the latest user or skill message, for rules that read intent. */
  request: string;
}

export interface BeforeModelEvent {
  stage: "before_model";
  /** The request in hand: the latest user or skill message. */
  text: string;
}

/** Everything a rule may read besides its event. */
export interface RuleContext {
  ledger: EvidenceLedger;
  state: PolicyState;
  /** The tools this turn was built with, so rules can see which connections are enabled. */
  tools: FinanceTool[];
  time: TimeContext;
  profile?: InvestorProfile | null;
  /** Account names and holdings figures that must not leave (rule P3). */
  privacy?: PrivacySummary;
  /** Every check recorded this turn so far, by any concern; read from the harness turn. */
  readonly checks: readonly CheckRecord[];
  /** Shared correction budget, read from the harness turn. */
  readonly followUpsLeft: number;
  /** False when the sandbox is unavailable or the current request cannot use its tool. */
  readonly calculatorAvailable: boolean;
  /** Tickers this chat's messages name; P1 adds those of the ledger's entities. */
  tickers: string[];
  /** Wall clock, injected so freshness checks are testable. */
  now: () => number;
}

export type BeforeToolRule = (event: BeforeToolEvent, context: RuleContext) => Verdict | undefined;
export type AfterToolRule = (event: AfterToolEvent, context: RuleContext) => Verdict | undefined;
export type BeforeStopRule = (event: BeforeStopEvent, context: RuleContext) => Verdict | undefined;
export type BeforeModelRule = (event: BeforeModelEvent, context: RuleContext) => Verdict | undefined;
