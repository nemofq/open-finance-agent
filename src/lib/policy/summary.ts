import type { EvidenceEntry } from "@/lib/evidence/types";
import type { AnswerFooter, CheckMessage, CheckRecord, RuleId } from "./types";

/** How the UI, the footer and the benchmark name each rule. */
export const RULE_TITLES: Record<RuleId, string> = {
  P1: "Trusted sources first",
  P2: "Duplicate data call",
  P3: "Personal data leaving",
  P4: "Stale quote",
  P5: "Sources disagree",
  P6: "Undeclared calculator constants",
  P8: "Unsourced figures",
  P9: "Unverified figures",
  P11: "Recommendation wording",
  P12: "Profile mismatch",
  P13: "Look-ahead evidence",
  H1: "Answer cut off",
  delivery: "Answer delivery",
};

/**
 * A check as it goes on the transcript. Every check is saved this way; `convertToLlm` drops it,
 * because a follow-up already reached the model as the user message `compose` queued.
 */
export function checkMessage(check: CheckRecord): CheckMessage {
  return { role: "check", check, timestamp: check.timestamp };
}

function figuresOf(checks: CheckRecord[], rule: RuleId): number {
  return new Set(checks.filter((check) => check.rule === rule).flatMap((check) => check.figures ?? [])).size;
}

function acted(checks: CheckRecord[], kind: CheckRecord["kind"]): number {
  return checks.filter((check) => check.kind === kind && check.enforced).length;
}

/**
 * The counts under an answer: what the ledger holds, and what the checks found. `entries` is the
 * ledger's content: `ledger.list()` on the server, the entries the tool results carried in the
 * chat, which is what a reloaded chat rebuilds the ledger from, so the two agree.
 * Actions are counted only where they took effect, so an observe-mode run reports none; flags
 * are listed either way, since a flag only ever produces a record.
 */
export function summarizeChecks(checks: CheckRecord[], entries: readonly EvidenceEntry[]): AnswerFooter {
  const count = (kind: EvidenceEntry["kind"]) => entries.filter((entry) => entry.kind === kind).length;
  const retrieved = entries.filter((entry) => entry.kind === "E");
  const computed = count("C");
  const assumed = count("A");
  const userProvided = count("U");

  return {
    figures: retrieved.length + computed + assumed + userProvided,
    retrieved: retrieved.length,
    computed,
    assumed,
    userProvided,
    unsourced: figuresOf(checks, "P8"),
    conflicts: retrieved.filter((entry) => entry.conflicts?.some((conflict) => !conflict.agree)).length,
    unverified: figuresOf(checks, "P9"),
    flags: checks.filter((check) => check.kind === "flag"),
    blocks: acted(checks, "block"),
    served: acted(checks, "serve"),
    followUps: acted(checks, "follow_up"),
  };
}
