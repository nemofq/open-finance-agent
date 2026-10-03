import { KIND_CLASS } from "@/lib/evidence/ids";
import type { EvidenceEntry, FigureMatch } from "@/lib/evidence/types";
import { figureCoverage } from "../reporting/metrics";
import { normalizePeriod, normalizeSourceUrl, sameStatement } from "../offline/coverage-contract";
import { asRecord, deliveredReportProse, deliveredReportSpecs, deliveredReportVerification } from "./report-content";
import { verifiedCalculation } from "./calculation-contract";
import {
  BENCHMARK_VERSION,
  type DeterministicCheckResult,
  type EvalEvidenceRequirement,
  type EvalFactEvidence,
  type EvalLedgerEvidence,
  type EvalSourceEvidence,
  type EvalTask,
  type ToolCallTrace,
} from "../types";

/**
 * The v2 40-point integrity score: required evidence 12, exact figure support 12 and task contracts
 * 16. Entity discovery and raw calculator use remain diagnostics, not quality points.
 */

/**
 * No-ledger fallback: citation-shaped text, used only when no figure could be matched to a ledger.
 * The check notes call these fallbacks the "v1 rule"; the judge reads the notes, so they keep it.
 */
const CITATION_PATTERNS = [
  /\((?:EDGAR|AV|Alpha Vantage|Reuters|Bloomberg|WSJ|SEC|8-K|10-Q|10-K)[^)]+\)/gi,
  /\b000\d{7}-\d{2}-\d{6}\b/g, // SEC accession number
  /\[(?:EDGAR|SEC|Alpha Vantage|Reuters|Bloomberg|WSJ)[^\]]+\]/gi,
  /\bhttps?:\/\/(?:www\.)?sec\.gov\/[^\s)]+/gi,
];

export interface ChecksInput {
  task: EvalTask;
  toolCalls: ToolCallTrace[];
  finalText: string;
  sessionTickers: string[];
  /** Ledger entries for this run; `C` entries are the calculator's derived figures. */
  evidence: EvidenceEntry[];
  figureMatches: FigureMatch[];
  /** Figures in the delivered reports (successful `create_report` calls), matched the same way. */
  reportFigureMatches?: FigureMatch[];
  /** A ledger was rebuilt, so the evidence-aware rules apply instead of the no-ledger fallbacks. */
  evidenceAvailable: boolean;
  /** Reports rendered by delivery recovery are visible, but do not satisfy agent delivery. */
  fallbackReports?: number;
}

function countCitationMarkers(text: string): number {
  return CITATION_PATTERNS.reduce((total, pattern) => total + (text.match(pattern)?.length ?? 0), 0);
}

/** Entities may show up as a session ticker, in a tool argument, or anywhere in the answer. */
function matchEntities(input: ChecksInput): { matched: string[]; missing: string[] } {
  const haystack = [
    input.finalText,
    input.sessionTickers.join(" "),
    JSON.stringify(input.toolCalls.map((call) => call.args)),
  ].join("\n");

  const matched: string[] = [];
  const missing: string[] = [];
  for (const cluster of input.task.expectedEntities) {
    const hits = cluster.aliases.some((alias) => {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`(^|[^a-zA-Z0-9$])${escaped}([^a-zA-Z0-9$]|$)`, "i");
      return pattern.test(haystack);
    });
    if (hits) matched.push(cluster.label);
    else missing.push(cluster.label);
  }
  return { matched, missing };
}

function normalizedUrls(values: unknown[]): string[] {
  return values.flatMap((url) => {
    if (typeof url !== "string") return [];
    try { return [normalizeSourceUrl(url)]; } catch { return []; }
  });
}

/**
 * URLs whose body the call returned. A search listing only shows that a page exists, so only
 * `web_fetch` (its `fetched` list) and `edgar_read_filing` (the document it read) acquire a source.
 */
function acquiredUrls(call: ToolCallTrace): string[] {
  const details = asRecord(call.details);
  if (!details || details.empty === true) return [];
  if (call.toolName === "web_fetch") return normalizedUrls(Array.isArray(details.fetched) ? details.fetched : []);
  if (call.toolName === "edgar_read_filing") return normalizedUrls([details.url]);
  return [];
}

/** Ledger entries that back at least one non-exempt figure, per the run's figure matching. */
function figureBackedIds(matches: FigureMatch[]): Set<string> {
  return new Set(matches.filter((match) => !match.figure.exempt).flatMap((match) => match.matches));
}

/** A quoted passage has to run this many consecutive words to count as relying on a source. */
const QUOTED_PASSAGE_WORDS = 8;

function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];
}

/** Every run of `QUOTED_PASSAGE_WORDS` consecutive words, case and punctuation ignored. */
function passages(text: string): Set<string> {
  const tokens = words(text);
  const grams = new Set<string>();
  for (let index = 0; index + QUOTED_PASSAGE_WORDS <= tokens.length; index++) {
    grams.add(tokens.slice(index, index + QUOTED_PASSAGE_WORDS).join(" "));
  }
  return grams;
}

/** A line that opens with an evidence tag, `[E7] …`: any kind, R included. */
export const EVIDENCE_TAG_LINE = new RegExp(String.raw`^\[${KIND_CLASS}\d+\b`);

/**
 * The body a source call returned, without the lines that only name the document: the evidence
 * tag, headings (a fetched page's title) and any line carrying a URL. Repeating a document's
 * title is a citation, not a quotation.
 */
function bodyText(call: ToolCallTrace): string {
  return call.output
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("#") && !EVIDENCE_TAG_LINE.test(trimmed) && !/https?:\/\//.test(trimmed);
    })
    .join("\n");
}

/** Where the answer, or a report the run delivered, shows it relied on a ledger entry. */
interface EvidenceUse {
  /** Entries that back a non-exempt figure in the answer or in a delivered report. */
  backed: Set<string>;
  /** Every run of consecutive words in the answer and in the delivered reports' prose. */
  shown: Set<string>;
  /**
   * Entries a used calculator result was computed from: the `inputs` lineage of every backed `C`
   * entry, followed through intermediate `C` entries.
   */
  derived: Set<string>;
}

/**
 * The ledger's lineage: what the backed calculator results were computed from. Only the `inputs`
 * the calculator recorded count; an entry that merely holds an equal value is not an input.
 */
function derivedFrom(backed: Set<string>, evidence: EvidenceEntry[]): Set<string> {
  const byId = new Map(evidence.map((entry) => [entry.id, entry]));
  const derived = new Set<string>();
  const pending = [...backed].filter((id) => byId.get(id)?.kind === "C");
  const visited = new Set(pending);
  while (pending.length > 0) {
    const computed = byId.get(pending.pop() ?? "");
    for (const input of computed?.inputs ?? []) {
      derived.add(input);
      if (byId.get(input)?.kind === "C" && !visited.has(input)) {
        visited.add(input);
        pending.push(input);
      }
    }
  }
  return derived;
}

/** Identifies evidence entries that back visible figures or quoted passages. */
function evidenceUse(input: ChecksInput): EvidenceUse {
  const backed = figureBackedIds([...input.figureMatches, ...(input.reportFigureMatches ?? [])]);
  return {
    backed,
    shown: passages(`${input.finalText}\n${deliveredReportProse(input.toolCalls)}`),
    derived: derivedFrom(backed, input.evidence),
  };
}

/** The answer or a delivered report quotes the body this call returned. */
function quotesBody(call: ToolCallTrace, entry: EvidenceEntry, use: EvidenceUse): boolean {
  if (use.shown.size === 0) return false;
  const naming = passages(entry.summary);
  for (const gram of passages(bodyText(call))) {
    if (use.shown.has(gram) && !naming.has(gram)) return true;
  }
  return false;
}

/** Tools the mock MCP serves; any other tool runs in-process and never gets an offline outcome. */
const LOCAL_TOOLS = new Set(["portfolio_get"]);

function served(call: ToolCallTrace): boolean {
  if (call.isError) return false;
  return LOCAL_TOOLS.has(call.toolName) ? call.offlineOutcome === undefined || call.offlineOutcome === "served" : call.offlineOutcome === "served";
}

/**
 * The ledger entries a call produced: those its result embedded under `details.evidence` that the
 * rebuilt ledger also holds. An entry that names a tool call must name this one, so an id copied
 * from elsewhere cannot be credited to the call.
 */
function entriesOf(call: ToolCallTrace, evidence: EvidenceEntry[]): EvidenceEntry[] {
  const embedded = asRecord(call.details)?.evidence;
  const ids = new Set((Array.isArray(embedded) ? embedded : [embedded]).flatMap((item) => {
    const id = asRecord(item)?.id;
    return typeof id === "string" ? [id] : [];
  }));
  return evidence.filter((entry) => ids.has(entry.id) &&
    (entry.toolCallId === undefined || entry.toolCallId === call.toolCallId) &&
    (entry.tool === undefined || entry.tool === call.toolName));
}

function tickerOf(entry: EvidenceEntry, call: ToolCallTrace): string {
  return String(entry.entity?.ticker ?? call.args.ticker ?? "").toUpperCase();
}

/**
 * The answer relies on the entry's figures: it shows a figure the matcher attributes to the entry,
 * or shows a calculator result whose recorded `inputs` lineage reaches the entry. A value computed
 * from the entry relies on it as much as the value itself; an entry that merely holds an equal
 * value is not in the lineage and earns nothing.
 */
function reliesOn(entry: EvidenceEntry, use: EvidenceUse): boolean {
  return use.backed.has(entry.id) || use.derived.has(entry.id);
}

/**
 * A source is used when the answer relies on the figures its read produced (see `reliesOn`),
 * or quotes its body: a stake change computed from the 13F's holding rows uses the 13F.
 */
type RequirementState = "missing" | "acquired" | "used";

function sourceState(requirement: EvalSourceEvidence, input: ChecksInput, use: EvidenceUse): RequirementState {
  const eligible = new Set(normalizedUrls(requirement.urls));
  const acquired = input.toolCalls.filter((call) => served(call) && acquiredUrls(call).some((url) => eligible.has(url)));
  if (acquired.length === 0) return "missing";
  return acquired.some((call) => entriesOf(call, input.evidence).some((entry) => reliesOn(entry, use) || quotesBody(call, entry, use)))
    ? "used"
    : "acquired";
}

/**
 * A statement fact is used when the answer relies on its entry (see `reliesOn`): a growth rate
 * computed from the served revenue relies on it as much as the revenue itself.
 */
function factState(requirement: EvalFactEvidence, input: ChecksInput, use: EvidenceUse): RequirementState {
  const entries = eligibleFactEntries(requirement, input);
  if (entries.length === 0) return "missing";
  return entries.some((entry) => reliesOn(entry, use)) ? "used" : "acquired";
}

function eligibleFactEntries(requirement: EvalFactEvidence, input: ChecksInput): EvidenceEntry[] {
  const ticker = requirement.ticker.toUpperCase();
  const period = requirement.period === undefined ? undefined : normalizePeriod(requirement.period);
  const entries: EvidenceEntry[] = [];
  for (const call of input.toolCalls) {
    if (call.toolName !== "edgar_financials" || !served(call)) continue;
    const statement = String(call.args.statement ?? asRecord(call.details)?.statement ?? "key_metrics");
    if (!sameStatement(requirement.statement, statement)) continue;
    entries.push(...entriesOf(call, input.evidence).filter((entry) =>
      entry.source?.tier === 1 && !entry.lookAhead && tickerOf(entry, call) === ticker &&
      (() => {
        const facts = (entry.facts ?? []).filter((fact) => {
          if (!Number.isFinite(fact.value)) return false;
          const end = (fact.end ?? fact.period).slice(0, 10);
          if (/^\d{4}-\d{2}-\d{2}$/.test(end) && end > input.task.asOfDate) return false;
          return period === undefined || normalizePeriod(fact.period) === period || normalizePeriod(fact.end ?? "") === period;
        });
        if (facts.some((fact) => fact.metric === requirement.metric)) return true;
        return requirement.metric === "grossMargin" && facts.some((fact) => fact.metric === "grossProfit") &&
          facts.some((fact) => fact.metric === "revenue" && fact.value !== 0);
      })()));
  }
  return entries;
}

/** Tools whose served result is a dated quote for the symbol(s) they were asked about. */
const QUOTE_TOOLS = new Set(["market_quotes", "alphavantage__GLOBAL_QUOTE", "alphavantage__TIME_SERIES_DAILY"]);

/**
 * A holdings or quote entry is used when the answer relies on it (see `reliesOn`): portfolio
 * weights computed from the quotes and the declared quantities use both.
 */
function ledgerState(requirement: EvalLedgerEvidence, input: ChecksInput, use: EvidenceUse): RequirementState {
  const ticker = requirement.ticker?.toUpperCase();
  const entries: EvidenceEntry[] = [];
  for (const call of input.toolCalls) {
    const eligible = requirement.source === "holdings" ? call.toolName === "portfolio_get" : QUOTE_TOOLS.has(call.toolName);
    if (!eligible || !served(call)) continue;
    // A multi-symbol quote is one entry named after its first symbol; the call's own symbols,
    // less any the mock reported missing, say which quotes that entry holds.
    const requested = (Array.isArray(call.args.symbols) ? call.args.symbols : call.args.symbol === undefined ? [] : [call.args.symbol])
      .map((symbol) => String(symbol).toUpperCase());
    const missing = asRecord(call.details)?.missing;
    const unserved = new Set((Array.isArray(missing) ? missing : []).map((item) => String(asRecord(item)?.symbol ?? "").toUpperCase()));
    entries.push(...entriesOf(call, input.evidence).filter((entry) => ticker === undefined ||
      entry.entity?.ticker?.toUpperCase() === ticker || (requested.includes(ticker) && !unserved.has(ticker))));
  }
  if (entries.length === 0) return "missing";
  return entries.some((entry) => reliesOn(entry, use)) ? "used" : "acquired";
}

function requirementState(requirement: EvalEvidenceRequirement, input: ChecksInput, use: EvidenceUse): RequirementState {
  return requirement.kind === "source" ? sourceState(requirement, input, use)
    : requirement.kind === "fact" ? factState(requirement, input, use)
      : ledgerState(requirement, input, use);
}

function namedRequirements(labels: string[], task: EvalTask): EvalEvidenceRequirement[] {
  return labels.map((label) => {
    const requirement = task.requiredEvidence.find((item) => item.label === label);
    if (!requirement) throw new Error(`Task ${task.id} contract names an unknown evidence requirement: ${label}`);
    return requirement;
  });
}

/** Traceability only: the named source was read and explicitly linked from delivered prose. */
function citedSource(requirement: EvalEvidenceRequirement, input: ChecksInput, claim?: "btc_holdings" | "convertible_terms"): boolean {
  if (requirement.kind !== "source") throw new Error(`Task ${input.task.id} citation contract requires source evidence: ${requirement.label}`);
  const eligible = new Set(normalizedUrls(requirement.urls));
  const delivered = `${input.finalText}\n${deliveredReportProse(input.toolCalls)}`;
  return input.toolCalls.some((call) => served(call) && acquiredUrls(call).some((url) => eligible.has(url)) &&
    delivered.split(/\n\s*\n/).some((paragraph) => {
      const cites = entriesOf(call, input.evidence).some((entry) => paragraph.includes(`[${entry.id}]`)) ||
        [...eligible].some((url) => paragraph.includes(url));
      if (!cites || !claim) return cites;
      if (claim === "btc_holdings") return /(?:bitcoin|\bBTC\b)/i.test(paragraph) && /386[,\s]?700|386\.7\s*(?:thousand|k)/i.test(paragraph);
      return /(?:convertib|\bnotes?\b|borrow|\bdebt\b)/i.test(paragraph) &&
        /(?:zero[ -]?coupon|0\s*%|2029|\$\s*(?:2\.6|3(?:\.0)?)\s*(?:billion|bn|b)\b)/i.test(paragraph);
    }));
}

/**
 * Each requirement earns its points when the outcome exists and the answer genuinely uses it: a
 * source was read, a statement fact was served, or a portfolio or quote entry was produced, and
 * the answer or a delivered report shows a non-exempt figure the matcher attributes to that entry,
 * or a calculator result whose recorded lineage reaches it (a source may instead be quoted, see
 * `evidenceUse`). A tag without a figure scores nothing, and
 * a figure without a tag is not penalised, since that would score formatting. Which tool got
 * there is not scored.
 */
function scoreEvidence(requirements: EvalEvidenceRequirement[], input: ChecksInput): {
  points: number;
  used: string[];
  acquired: string[];
  missing: string[];
} {
  const use = evidenceUse(input);
  const used: string[] = [];
  const acquired: string[] = [];
  const missing: string[] = [];
  let points = 0;
  for (const requirement of requirements) {
    const state = requirementState(requirement, input, use);
    if (state === "used") {
      used.push(requirement.label);
      points += requirement.points;
    } else if (state === "acquired") {
      acquired.push(requirement.label);
      points += requirement.points / 2;
    } else {
      missing.push(requirement.label);
    }
  }
  return { points, used, acquired, missing };
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}

function contractResults(input: ChecksInput, use: EvidenceUse): DeterministicCheckResult["contractResults"] {
  const specs = deliveredReportSpecs(input.toolCalls);
  return input.task.contracts.map((contract) => {
    let met = false;
    if (contract.kind === "verified_calculation") {
      met = verifiedCalculation(contract, input.task, input.evidence, use.backed);
    } else if (contract.kind === "required_evidence_used") {
      met = namedRequirements(contract.requirementLabels, input.task)
        .every((requirement) => requirementState(requirement, input, use) === "used");
    } else if (contract.kind === "required_evidence_cited") {
      met = contract.citations.every((check) => {
        const citations = namedRequirements(check.requirementLabels, input.task)
          .map((requirement) => citedSource(requirement, input, check.claim));
        return check.match === "all" ? citations.every(Boolean) : citations.some(Boolean);
      });
    } else if (contract.kind === "dated_quote") {
      met = input.toolCalls.some((call) => QUOTE_TOOLS.has(call.toolName) && served(call) &&
        entriesOf(call, input.evidence).some((entry) => !entry.lookAhead && use.backed.has(entry.id) &&
          (entry.facts ?? []).some((fact) => fact.period === contract.date && fact.unit === "USD" && fact.value > 0 &&
            (fact.metric === `${contract.ticker} price` ||
              (entry.entity?.ticker?.toUpperCase() === contract.ticker && ["price", "close"].includes(fact.metric))))));
    } else if (contract.kind === "no_lookahead") {
      met = input.evidence.length > 0 && !input.evidence.some((entry) => entry.lookAhead && (use.backed.has(entry.id) || use.derived.has(entry.id)));
    } else {
      met = (input.fallbackReports ?? 0) === 0 && specs.some((spec) => {
        const headings = new Set(spec.sections.map((section) => section.heading.toLowerCase()));
        return spec.template === contract.template && contract.sections.every((section) => headings.has(section.toLowerCase()));
      });
    }
    return { id: contract.id, label: contract.label, met, points: met ? contract.points : 0 };
  });
}

export function runDeterministicChecks(input: ChecksInput): DeterministicCheckResult {
  const { task } = input;
  if (!input.finalText.trim()) {
    return {
      version: BENCHMARK_VERSION,
      identifiedAllEntities: false,
      matchedEntities: [],
      missingEntities: task.expectedEntities.map((entity) => entity.label),
      derivedFigures: 0,
      mathExpectationSatisfied: false,
      citationCount: 0,
      figuresChecked: 0,
      figuresBacked: 0,
      evidenceAvailable: input.evidenceAvailable,
      evidenceScore: 0,
      figureSupportScore: 0,
      contractScore: 0,
      contractResults: task.contracts.map((contract) => ({ id: contract.id, label: contract.label, met: false, points: 0 })),
      score: 0,
      maxScore: 40,
      details: ["[Answer: 0/40] The agent produced no final answer."],
    };
  }
  const details: string[] = [];

  /* Entity discovery is diagnostic only in v2. */
  const entities = matchEntities(input);
  details.push(
    task.expectedEntities.length === 0
      ? "[Entities: diagnostic] No specific entity required."
      : `[Entities: diagnostic] found [${entities.matched.join(", ") || "none"}]` +
          (entities.missing.length > 0 ? `, missing [${entities.missing.join(", ")}]` : ""),
  );

  /* 1. Required evidence — 12. Acquisition earns half; visible use earns full. */
  const evidence = scoreEvidence(task.requiredEvidence, input);
  const evidenceScore = rounded((evidence.points / 15) * 12);
  details.push(
    `[Evidence: ${evidenceScore}/12] used [${evidence.used.join(", ") || "none"}]; acquired only [${evidence.acquired.join(", ") || "none"}]; missing [${evidence.missing.join(", ") || "none"}]`,
  );

  /* Raw calculator use remains diagnostic. The task-specific arithmetic contract is decisive. */
  const derivedFigures = input.evidence.filter((entry) => entry.kind === "C").length;
  const use = evidenceUse(input);
  const calculationContracts = task.contracts.filter((contract) => contract.kind === "verified_calculation");
  const mathExpectationSatisfied = calculationContracts.length > 0
    ? calculationContracts.every((contract) => verifiedCalculation(contract, task, input.evidence, use.backed))
    : !task.requiresMathCalculation || input.evidence.some((entry) => entry.kind === "C" && use.backed.has(entry.id));
  details.push(`[Calculator: diagnostic] ${derivedFigures} derived figure(s); ${mathExpectationSatisfied ? "calculation expectation met or none required" : "calculation expectation not met"}.`);

  /* 2. Figure support — 12 points. Counts figures the ledger backs, combining the delivered report's
     figures, per the report validator's own per-figure summary, with the answer's. */
  const citationCount = countCitationMarkers(input.finalText);
  // One ratio over everything the reader sees: the chat answer and any delivered report,
  // weighted by how many figures each shows.
  const chat = figureCoverage(input.figureMatches);
  const verification = deliveredReportVerification(input.toolCalls);
  // Repaired references are harness help, not agent credit in v2.
  const fromReport = verification
    ? { checked: verification.checked, backed: Math.min(verification.checked, verification.supported), unsourced: [] as string[] }
    : { checked: 0, backed: 0, unsourced: [] as string[] };
  const coverage = {
    checked: chat.checked + fromReport.checked,
    backed: chat.backed + fromReport.backed,
    unsourced: [...chat.unsourced, ...fromReport.unsourced],
  };
  const reportNote = verification
    ? ` (${verification.checked} from the delivered report, per its validator: ${verification.unverified} unsupported` +
      (verification.repaired > 0 ? `, ${verification.repaired} citation(s) repaired` : "") + ")"
    : ` (${fromReport.checked} from the delivered report)`;
  let figureSupportScore: number;
  if (input.evidenceAvailable && coverage.checked > 0) {
    figureSupportScore = rounded((coverage.backed / coverage.checked) * 12);
    details.push(
      `[Figure support: ${figureSupportScore}/12] ${coverage.backed}/${coverage.checked} non-exempt figures backed by evidence` +
        reportNote +
        (coverage.unsourced.length > 0 ? `; unsourced: ${coverage.unsourced.slice(0, 8).join(", ")}` : ""),
    );
  } else {
    figureSupportScore = 0;
    details.push(
      citationCount > 0
        ? `[Figure support: 0/12] ${citationCount} source marker(s), but no figures could be verified.`
        : "[Figure support: 0/12] No verifiable non-exempt figures.",
    );
  }

  /* 3. Task-specific contracts — 16. */
  const contracts = contractResults(input, use);
  const contractScore = rounded(contracts.reduce((total, contract) => total + contract.points, 0));
  details.push(`[Contracts: ${contractScore}/16] ${contracts.map((contract) => `${contract.met ? "met" : "missed"} ${contract.label}`).join("; ")}`);

  const score = rounded(evidenceScore + figureSupportScore + contractScore);

  return {
    version: BENCHMARK_VERSION,
    identifiedAllEntities: entities.missing.length === 0,
    matchedEntities: entities.matched,
    missingEntities: entities.missing,
    derivedFigures,
    mathExpectationSatisfied,
    citationCount,
    figuresChecked: coverage.checked,
    figuresBacked: coverage.backed,
    evidenceAvailable: input.evidenceAvailable,
    evidenceScore,
    figureSupportScore,
    contractScore,
    contractResults: contracts,
    score,
    maxScore: 40,
    details,
  };
}
