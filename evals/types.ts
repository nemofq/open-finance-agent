import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { EvidenceEntry, FigureMatch } from "@/lib/evidence/types";
import type { ManualPositionInput } from "@/lib/portfolio/types";
import type { ProfileInput } from "@/lib/profile/schema";
import type { CheckRecord, PolicyMode } from "@/lib/policy/types";
import type { TurnStop } from "@/lib/agent/execution";
import type { ThinkingLevel } from "@/lib/config/schema";

/**
 * Shared vocabulary of the developer benchmark. The suite is developer-only:
 * no UI, no settings, and `pnpm test` never runs it — only the harness unit tests beside these files.
 */

/** Covers the tasks, the deterministic checks, the judge prompt and the scoring. */
export const BENCHMARK_VERSION = "2";

/**
 * Where a run's data comes from: the committed offline dataset (the only scored mode), the live
 * providers, or the live providers while capturing their responses for the dataset compiler.
 */
export type FixtureMode = "offline" | "live" | "record";

/* ------------------------------------------------------------------ tasks */

export interface EvalTaskRubric {
  /** How well the agent identifies latent entities, underlying motives, and investor misconceptions */
  intentScoreCriteria: string;
  /** Primary source citation, factuality, and absence of hallucinations */
  dataGroundingCriteria: string;
  /** Soundness of financial logic, scenario analysis, and arithmetic accuracy */
  financialReasoningCriteria: string;
  /** Clarity for retail investors, avoiding unhedged buy/sell recommendations */
  retailClarityCriteria: string;
}

export type RubricDimension = "intent" | "financial" | "grounding" | "clarity";
export type RubricVerdict = "met" | "partial" | "missed" | "contradicted";

/**
 * One independently judged requirement. Weights across the non-gating items of a task total 60.
 * A zero-weight critical item is a gate: it can cap a superficially polished but materially wrong
 * answer without double-counting the broader dimension that already scores the same behaviour.
 */
export interface EvalRubricItem {
  id: string;
  dimension: RubricDimension;
  label: string;
  requirement: string;
  weight: number;
  critical?: boolean;
  /** Offline-corpus records that make a critical requirement answerable before its cutoff. */
  coverage?: {
    requiredEvidenceLabels?: string[];
    alphaEarningsTickers?: string[];
  };
}
export type EvalCalculationTarget =
  | { kind: "fact_growth"; ticker: string; metric: string; periodType: "quarterly" | "annual"; currentPeriod: string; priorPeriod: string }
  | { kind: "fact_sum"; ticker: string; metric: string; periodType: "quarterly" | "annual"; periods: string[] }
  | { kind: "annual_income_rate"; principal: number; monthlyIncome: number }
  | { kind: "portfolio_top_weight"; quoteDate: string }
  | { kind: "filing_guidance_growth"; url: string; currentRevenue: number; guidedRevenue: number };

export type EvalTaskContract =
  | {
      id: string;
      kind: "verified_calculation";
      label: string;
      points: number;
      target: EvalCalculationTarget;
      /** Absolute tolerance in the target's output unit, not a percentage of its value. */
      tolerance: number;
    }
  | {
      id: string;
      kind: "required_evidence_used";
      label: string;
      points: number;
      requirementLabels: string[];
    }
  | {
      id: string;
      kind: "required_evidence_cited";
      label: string;
      points: number;
      /** Every citation check must pass; each may accept equivalent source filings. */
      citations: Array<{
        requirementLabels: string[];
        match: "all" | "any";
        /** Claim that must accompany the filing citation in delivered prose. */
        claim?: "btc_holdings" | "convertible_terms";
      }>;
    }
  | {
      id: string;
      kind: "dated_quote";
      label: string;
      points: number;
      ticker: string;
      date: string;
    }
  | {
      id: string;
      kind: "no_lookahead";
      label: string;
      points: number;
    }
  | {
      id: string;
      kind: "report";
      label: string;
      points: number;
      template: string;
      sections: string[];
      /** A report rendered by the harness from prose is recovery, not agent delivery. */
      requireAgentDelivery: boolean;
    };

export interface EntityCluster {
  label: string;
  aliases: string[];
}

interface EvalEvidenceBase {
  /** What the answer must show, e.g. "Nike Q4 FY24 results release". */
  label: string;
  /** Points assigned to this requirement; a task's requirements total 15. */
  points: number;
}

/** An official document whose body was read (not merely listed by a search) and then used. */
export interface EvalSourceEvidence extends EvalEvidenceBase {
  kind: "source";
  /** At least one eligible URL must be both acquired and used. */
  urls: string[];
}

/** A statement fact served by `edgar_financials` and then used. */
export interface EvalFactEvidence extends EvalEvidenceBase {
  kind: "fact";
  ticker: string;
  statement: "income" | "balance" | "cashflow" | "key_metrics";
  /** Ledger metric id, i.e. the statement row id (`revenue`, `grossMargin`, `capex`). */
  metric: string;
  /** Period label or end date the fact must carry, e.g. `2024-09-28`. */
  period?: string;
}

/**
 * A ledger entry no document can stand in for, then used. `holdings` is the user's declared
 * portfolio read through `portfolio_get`; `quote` is a dated price from any served quote tool
 * (`market_quotes`, `alphavantage__GLOBAL_QUOTE`, `alphavantage__TIME_SERIES_DAILY`), since which
 * price route the model took is not scored.
 */
export interface EvalLedgerEvidence extends EvalEvidenceBase {
  kind: "ledger";
  source: "holdings" | "quote";
  ticker?: string;
}

export type EvalEvidenceRequirement = EvalSourceEvidence | EvalFactEvidence | EvalLedgerEvidence;

export type EvalTaskCategory =
  | "earnings_paradox"
  | "moat_erosion"
  | "thematic_purity"
  | "dividend_trap"
  | "value_trap"
  | "proxy_leverage"
  | "narrative_factcheck"
  | "accounting_red_flag"
  // The four harness task types.
  | "report_delivery"
  | "profile_fit"
  | "figure_survival"
  | "pre_open_timing";

export interface EvalTask {
  id: string;
  category: EvalTaskCategory;
  title: string;
  /** Natural, ambiguous, retail-investor prompt */
  prompt: string;
  /** Historical simulation date YYYY-MM-DD; becomes the turn's fixed `TimeContext` and `ModuleContext.asOf`. */
  asOfDate: string;
  /** How the offline dataset scopes this task; see `EvalTaskDataset`. */
  dataset: EvalTaskDataset;
  /** Latent intent explanation */
  latentIntent: string;
  /** Entity clusters (each with acceptable aliases/tickers) that must be inferred */
  expectedEntities: EntityCluster[];
  /** Evidence outcomes whose requirement weights total 15 and are normalized onto v2's 12 integrity points. */
  requiredEvidence: EvalEvidenceRequirement[];
  /** Whether quantitative formulas / math calculations are required */
  requiresMathCalculation?: boolean;
  /** Rubric for grading */
  rubric: EvalTaskRubric;
  /** The v2 semantic scorecard. Non-gating item weights total 60. */
  rubricItems: EvalRubricItem[];
  /** The v2 deterministic task contract. Points total 16. */
  contracts: EvalTaskContract[];

  /* ---- optional harness inputs; every field below is seeded before the first turn ---- */

  /** Run the turn as this skill, exactly as the composer's `/` picker does. */
  skill?: string;
  /** Written to `profile.json` in the run's temporary home before the turn. */
  profile?: ProfileInput;
  /**
   * File under `evals/dataset/profiles/` holding the profile text the system prompt carries, in
   * place of the app's rendering of `profile`. Frozen, so a change to that rendering never changes
   * what the task's model reads; `profile` is still seeded, so P12 and the tools read it as before.
   */
  profilePrompt?: string;
  /**
   * Positions written into the run's temporary holdings ledger before the turn, each in a taxable
   * benchmark account the runner creates for its `accountId`.
   */
  holdings?: ManualPositionInput[];
  /**
   * Additional turns on the same session. Only the last answer is graded, while every prompt and
   * every turn's tool trace is shown to the judge. Use this for compaction and evolving instructions.
   */
  followUpPrompts?: string[];
  /**
   * New York wall-clock time (`HH:mm`) the turn is asked at, e.g. `08:15` for a question before the
   * open, so the market state is real (pre-market, open, closed). Against the offline dataset the
   * turn keeps its fixed date and this time is the intraday cutoff the compiled scope applies.
   * Against live providers (`live`, `record`) the turn runs at that instant in live time mode,
   * which sets no `asOf`: its data tools have no point-in-time cutoff, so a capture of such a task
   * needs a review by hand before it is compiled.
   *
   * Interpreted as eastern *daylight* time, so `asOfDate` must fall between mid-March and early
   * November.
   */
  asOfTime?: string;
}

/**
 * What the offline dataset compiler (`scripts/compile-offline-dataset.ts`) reads from a task to
 * build its scope, besides the as-of date and time. The mock MCP serves the compiled scope, so
 * changing a value here changes nothing until the dataset is recompiled.
 */
export interface EvalTaskDataset {
  /**
   * Symbols the task may compare against besides its own. The compiler adds their pinned Alpha
   * Vantage history, and a quote the dataset lacks for one reads as not captured, not out of scope.
   */
  peerTickers: string[];
  /**
   * Words that tie a web search to this task. A query sharing one is anchored and may match a
   * captured document on a single word; captured search results carry them as topics.
   */
  searchTopics: string[];
  /** Folder under `evals/source-materials/` whose `manifest.json` pins hand-captured sources. */
  sourceMaterials?: string;
}

/* ------------------------------------------------------------------ trace */

export type OfflineOutcome = "served" | "empty" | "out_of_scope" | "not_captured" | "not_available_as_of";

export type OfflineAuditKind =
  | "empty_result"
  | "not_captured"
  | "out_of_scope"
  | "not_available_as_of"
  | "out_of_scope_query"
  | "integrity_error";

export interface OfflineAuditEvent {
  tool: string;
  kind: OfflineAuditKind;
  normalizedRequest: unknown;
  urls?: string[];
  reason: string;
}

export interface OfflineAudit {
  emptyProviderResults: number;
  corpusNotCaptured: number;
  notAvailableAsOf: number;
  outOfScopeQueries: number;
  integrityErrors: number;
  events: OfflineAuditEvent[];
}

/** A task result's operational state, independent from its numeric score. */
export type TaskResultStatus =
  | "completed"
  | "agent_timeout"
  /** The turn ran out of its model-call budget or stalled research. A model outcome, like a timeout. */
  | "agent_budget"
  | "agent_error"
  | "infra_error"
  | "harness_error"
  | "judge_error";

export interface ToolCallTrace {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  /** The full model-facing text of the result; never truncated in the run record. */
  output: string;
  /** Structured `details` from the transcript's tool result, when the tool returned any. */
  details?: unknown;
  durationMs: number;
  isError: boolean;
  offlineOutcome?: OfflineOutcome;
}

/* ----------------------------------------------------------------- checks */

export interface DeterministicCheckResult {
  /** Benchmark version whose rules produced this score. */
  version: string;

  identifiedAllEntities: boolean;
  matchedEntities: string[];
  missingEntities: string[];

  /** Derived figures the calculator registered in the ledger (`C` entries). */
  derivedFigures: number;
  mathExpectationSatisfied: boolean;

  /** Source markers in the answer, which score the citation part only when no figure could be checked. */
  citationCount: number;
  /** Non-exempt figures in the final answer and any delivered report, and how many the ledger backs. */
  figuresChecked: number;
  figuresBacked: number;

  /** True when the ledger was available, so the evidence-based rules applied rather than the no-ledger fallbacks. */
  evidenceAvailable: boolean;

  /** v2 source/fact acquisition and use score, out of 12. */
  evidenceScore: number;
  /** v2 exact figure-support score, out of 12. */
  figureSupportScore: number;
  /** v2 task-specific contract score, out of 16. */
  contractScore: number;
  contractResults: Array<{ id: string; label: string; met: boolean; points: number }>;

  /** Total deterministic integrity score (out of 40 points). */
  score: number;
  maxScore: number;
  details: string[];
}

/* ---------------------------------------------------------------- metrics */

/** Reported, never scored. */
export interface RunMetrics {
  /** Share of non-exempt figures in the final answer with no matching ledger entry; -1 when unknown. */
  unsourcedFigureRate: number;
  unsourcedFigures: string[];
  /** Evidence entries per source tier, keyed `tier1`…`tier4`. */
  sourceTierMix: Record<string, number>;
  conflictsDetected: number;
  conflictsAddressed: number;
  lookAheadEvidence: number;
  evidenceEntries: number;
  followUps: number;
  blocks: number;
  flags: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  costUsd: number;
  latencyMs: number;
  modelCalls: number;
}

/** Reported, never scored: signs the answer needed the harness's help to arrive. */
export interface RunDiagnostics {
  /** Tool results rejected for malformed arguments. */
  toolArgumentErrors: number;
  /** Reports the harness rendered from the chat answer because the model never delivered one. */
  fallbackReports: number;
  /** Figures successful reports carried without ledger backing (the validator's `unverified`). */
  unverifiedFigures: number;
  /** Report citations the validator corrected to the entry that holds the value. */
  repairedFigures: number;
}

/* ------------------------------------------------------------------ judge */

export interface RubricItemEvaluation {
  id: string;
  dimension: RubricDimension;
  verdict: RubricVerdict;
  rationale: string;
  /** Short quotation or precise description of the answer passage being judged. */
  answerEvidence: string;
  evidenceIds: string[];
  awarded: number;
  weight: number;
  critical: boolean;
}

export interface JudgeEvaluationResult {
  rubricItems: RubricItemEvaluation[];
  dimensionScores: Record<RubricDimension, number>;
  /** Kept as named fields so old summary consumers have a simple migration path. */
  intentScore: number; // 0-15
  intentFeedback: string;
  financialScore: number; // 0-20
  financialFeedback: string;
  groundingScore: number; // 0-15
  groundingFeedback: string;
  retailClarityScore: number; // 0-10
  retailClarityFeedback: string;
  totalJudgeScore: number; // 0-60
  maxJudgeScore: number; // 60
  criticalMisses: string[];
  criticalContradictions: string[];
  /** 69 for a missed critical item, 49 for a contradiction, otherwise absent. */
  scoreCap?: number;
  overallVerdict: string;
  judgeModel: string;
  promptVersion: string;
  /** Unmodified judge text retained for auditing valid and rejected rubric responses. */
  rawResponse?: string;
  /** True when one format-only repair pass was needed. */
  repairAttempted?: boolean;
  /** The rejected first response, retained for auditability. */
  initialRawResponse?: string;
  error?: string;
}

/* ---------------------------------------------------------------- results */

export interface TaskEvalResult {
  task: EvalTask;
  /** `provider/model` of the agent that produced this answer. */
  agent: string;
  /** 1-based repeat index within the run. */
  repeat: number;
  status: TaskResultStatus;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  toolCalls: ToolCallTrace[];
  evidence: EvidenceEntry[];
  checks: CheckRecord[];
  figureMatches: FigureMatch[];
  /** Figures in the delivered reports, matched against the same ledger; absent when none. */
  reportFigureMatches?: FigureMatch[];
  finalAssistantText: string;
  sessionTickers: string[];
  /** The whole transcript of the benchmark session, as persisted in the temporary data folder. */
  transcript: AgentMessage[];
  deterministicCheck: DeterministicCheckResult;
  judgeResult?: JudgeEvaluationResult;
  /** Item-level semantic quality out of 60, present only for a judgeable completed/budget answer. */
  qualityScore?: number;
  /** Deterministic integrity out of 40. */
  integrityScore?: number;
  /** Combined v2 score out of 100 after any critical-item cap. */
  totalScore?: number;
  /** False means infrastructure, harness/data, or judge failure made this result non-comparable. */
  valid?: boolean;
  invalidReason?: string;
  metrics: RunMetrics;
  diagnostics: RunDiagnostics;
  offlineAudit?: OfflineAudit;
  /** Number of transient provider retries used during this task. */
  providerRetries?: number;
  /** Provider errors that triggered retries, retained for operational audit. */
  providerRetryErrors?: string[];
  error?: string;
  /** Why the agent's turn was stopped, when a budget or deadline stopped it; decides the status. */
  stop?: TurnStop;
}

/** Per-task descriptive spread across `--repeat`; v2 regression gates use paired bootstrap. */
export interface TaskStat {
  taskId: string;
  title: string;
  runs: number;
  scores: number[];
  meanIntegrity: number;
  meanQuality: number;
  meanTotal: number;
  /** Population standard deviation of the total score. */
  sdTotal: number;
  /** Historical descriptive 2σ value, not a v2 regression threshold. */
  tolerance: number;
}

export interface AgentSummary {
  agent: string;
  /** The agent and the judge are the same model, so the run grades itself. */
  selfJudged: boolean;
  completedTasks: number;
  erroredTasks: number;
  agentFailures: number;
  infrastructureErrors: number;
  invalidRuns: number;
  /** Share of valid cells that reached a judgeable completed/budget answer. */
  completionRate: number;
  /** Mean 0-100 combined score among completed answers only. */
  qualityOnCompleted: number;
  /** Task-macro expected user score; model failures are zero. */
  expectedUserScore: number;
  averageIntegrityScore: number;
  averageSemanticScore: number;
  /** Compatibility alias for expectedUserScore in v2 summaries. */
  averageTotalScore: number;
  criticalMissRate: number;
  criticalContradictionRate: number;
  maxPossibleScore: number;
  perTask: TaskStat[];
  metrics: RunMetrics;
  /** Summed over this agent's results. */
  diagnostics: RunDiagnostics;
}

export interface EvalRunSummary {
  timestamp: string;
  benchmarkVersion: string;
  judgePromptVersion: string;
  agents: string[];
  judge: string;
  thinking?: ThinkingLevel;
  /**
   * Agent spec → what the thinking level sent for that model: the level after clamping, and the
   * value it became where the catalog or the endpoint's mapping names one (`high → "xhigh"`,
   * `medium → high`, `max → "max"`), or how Off was sent (`off → chat-template`, `off → not sent`).
   */
  thinkingTransmitted?: Record<string, string>;
  /** The judge's thinking level, from `--judge-thinking`; absent when the judge was sent none. */
  judgeThinking?: ThinkingLevel;
  /** Judge spec → what `judgeThinking` put on the wire, as `thinkingTransmitted` records it. */
  judgeThinkingTransmitted?: Record<string, string>;
  /** Independent grades requested for each answer; v2 aggregates item verdicts by majority. */
  judgeRepeat?: number;
  /** Legacy judge calibration result; retained when reading older runs, never used for eligibility. */
  calibration?: {
    anchors: number;
    repeats: number;
    orderingAccuracy: number;
    weightedKappa: number;
    scoreMae: number;
    maxScoreStdDev: number;
    passed: boolean;
  };
  /** Offline dataset format and task-level content hashes, when the run used it. */
  dataset?: {
    version: string;
    taskHashes: Record<string, string>;
    /** Summed over the results' offline audits. */
    corpusNotCaptured: number;
    notAvailableAsOf: number;
    emptyProviderResults: number;
    outOfScopeQueries: number;
    integrityErrors: number;
  };
  fixtureMode: FixtureMode;
  policyMode: PolicyMode;
  /** SHA-256 of the run's config.json with every secret masked. */
  configHash: string;
  /** `git rev-parse HEAD`, when the run happened inside a git checkout. */
  commit?: string;
  repeat: number;
  taskIds: string[];
  agentSummaries: AgentSummary[];
  /** Summed over every result. */
  diagnostics: RunDiagnostics;
  results: TaskEvalResult[];
}

/** A committed baseline: the summary without the per-task traces, so the file stays small. */
export type BaselineRecord = Omit<EvalRunSummary, "results"> & {
  results: Omit<TaskEvalResult, "toolCalls" | "transcript" | "evidence" | "checks" | "figureMatches" | "reportFigureMatches">[];
};

/** Written after every task cell with `--checkpoint`; `--resume` continues only a matching run. */
export interface RunCheckpoint {
  version: string;
  /** The offline dataset's format, for an offline run. */
  datasetVersion?: string;
  fixtureMode: FixtureMode;
  agents: string[];
  judge: string;
  thinking?: string;
  judgeThinking?: string;
  judgeRepeat: number;
  taskIds: string[];
  repeat: number;
  taskDatasetHashes: Record<string, string>;
  results: TaskEvalResult[];
}
