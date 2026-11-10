import { extractFigures, figureEquals } from "@/lib/evidence/figures";
import { KIND_CLASS } from "@/lib/evidence/ids";
import type { Figure } from "@/lib/evidence/types";
import type { ToolCallTrace } from "../types";

export const OUTPUT_BUDGET = 6_000;
export const WINDOW_BUDGET = 2_400;
const CONTEXT = 220;
const OMITTED_CALL_BUDGET = 6_000;
export const EVIDENCE_TAG = new RegExp(String.raw`\[${KIND_CLASS}\d+(?:\s*,\s*${KIND_CLASS}\d+)*\]`);

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const small = `(?:(?:${TENS.join("|")})(?:[ -](?:${WORDS.slice(1, 10).join("|")}))?|${WORDS.join("|")})`;
const WORD_NUMBER = new RegExp(`\\b(?:${WORDS.slice(1, 10).join("|")}) hundred(?: (?:and )?${small})?\\b|\\b${small}\\b`, "gi");

/** Padding before the digits preserves original offsets and keeps the unit next to the number. */
export function excerptFigures(text: string): Figure[] {
  const normalized = text.replace(/^… \[[^\n]*\]$/gm, (line) => " ".repeat(line.length))
    .replace(/\bbasis point\b/gi, (unit) => "bp".padEnd(unit.length, " "))
    .replace(WORD_NUMBER, (phrase) => {
      let value = 0;
      for (const word of phrase.toLowerCase().split(/[ -]/)) {
        if (word === "hundred") value *= 100;
        else if (word !== "and") value += WORDS.includes(word) ? WORDS.indexOf(word) : (TENS.indexOf(word) + 2) * 10;
      }
      return String(value).padStart(phrase.length, " ");
    });
  return extractFigures(normalized).filter((figure) => !figure.exempt);
}

function matches(claim: Figure, source: Figure): boolean {
  // Retrieval must find prose directions as well as signs; the judge checks the original text.
  // Remove basis-point suffixes before precision parsing so their `b` is not read as billion.
  const magnitude = { ...claim, value: Math.abs(claim.value), raw: claim.raw.replace(/\bbasis points?\b|\bbps?\b/gi, "") };
  return figureEquals(magnitude, Math.abs(source.value), source.unit);
}

/**
 * Whether a figure already in the packet shows the claim. Stricter than finding where a claim's
 * source sits: a bare number (a table cell, an item or footnote number) does not show a figure with
 * a unit, so "U.S. | 7 | %" or "(1)" never hides "7 basis points" or "1 bp" from the windows. Only a
 * figure with three or more significant digits, such as "$269.9 billion" against a table's
 * "269,912", is recognised without its unit. A false match here withholds evidence, while a missed
 * one only costs a window, so this errs toward showing more.
 */
function shows(claim: Figure, source: Figure): boolean {
  if (!matches(claim, source)) return false;
  // figureEquals equates "7 basis points" with "7%" before converting units; here they must agree.
  if (claim.unit && source.unit && (claim.unit === "bps") !== (source.unit === "bps")) {
    const percent = (figure: Figure) => Math.abs(figure.value) / (figure.unit === "bps" ? 100 : 1);
    return Math.abs(percent(claim) - percent(source)) < 1e-9;
  }
  if (!claim.unit || source.unit) return true;
  return (claim.raw.match(/\d/g) ?? []).length >= 3;
}

export function uniqueClaims(text: string): Figure[] {
  const seen = new Set<string>();
  return excerptFigures(text).filter((figure) => {
    const key = `${figure.value}|${figure.unit ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The v9 packet's head and tail tag lines, also used as the free audit's control. */
export function truncateToolOutput(text: string, budget = OUTPUT_BUDGET): string {
  if (text.length <= budget) return text;
  const tags = text.slice(budget).split("\n").filter((line) => EVIDENCE_TAG.test(line)).slice(0, 20);
  return [text.slice(0, budget), `… [${text.length - budget} more characters omitted]`, ...tags].join("\n");
}

export function successfulEvidenceCalls(calls: ToolCallTrace[]): ToolCallTrace[] {
  return calls.filter((call) => call.toolName !== "create_report" && !call.isError &&
    !["not_captured", "out_of_scope", "not_available_as_of"].includes(call.offlineOutcome ?? "") && call.output.trim() !== "");
}

export function headCalls(calls: ToolCallTrace[]): ToolCallTrace[] {
  return calls.length <= 16 ? calls : [...calls.slice(0, 8), ...calls.slice(-8)];
}

interface Window { start: number; end: number }

/** Original source text only: numeric matches select passages, never certify a claim as correct. */
export function figureWindows(text: string, claims: Figure[], start = OUTPUT_BUDGET, budget = WINDOW_BUDGET): string {
  const windows: Window[] = [];
  const figures = excerptFigures(text);
  for (const claim of claims) {
    for (const source of figures) {
      if (source.index + source.raw.length <= start || !matches(claim, source)) continue;
      const next = { start: Math.max(source.index < start ? 0 : start, source.index - CONTEXT), end: Math.min(text.length, source.index + source.raw.length + CONTEXT) };
      const merged: Window[] = [];
      for (const window of [...windows, next].sort((a, b) => a.start - b.start)) {
        const last = merged.at(-1);
        if (last && window.start <= last.end) last.end = Math.max(last.end, window.end);
        else merged.push({ ...window });
      }
      const rendered = renderWindows(text, merged);
      if (rendered.length <= budget) {
        windows.splice(0, windows.length, ...merged);
        break;
      }
    }
  }
  return renderWindows(text, windows);
}

function renderWindows(text: string, windows: Window[]): string {
  return windows.map(({ start, end }) => `… [source characters ${start}-${end}]\n${text.slice(start, end)}`).join("\n");
}

export interface JudgeEvidenceOutput { call: ToolCallTrace; output: string; supplementary: boolean }

/** Keep v9's heads; recover missing figures from their tails and then from omitted middle calls. */
export function judgeEvidenceOutputs(calls: ToolCallTrace[], answerAndReport: string): JudgeEvidenceOutput[] {
  const candidates = successfulEvidenceCalls(calls);
  const selected = headCalls(candidates);
  const claims = uniqueClaims(answerAndReport);
  const outputs = selected.map((call) => {
    const head = truncateToolOutput(call.output);
    const visible = excerptFigures(head);
    const missing = claims.filter((claim) => !visible.some((source) => shows(claim, source)));
    const windows = figureWindows(call.output, missing);
    return { call, output: windows ? `${head}\n${windows}` : head, supplementary: false };
  });
  let remaining = OMITTED_CALL_BUDGET;
  let visible = outputs.flatMap(({ output }) => excerptFigures(output));
  for (const call of candidates) {
    if (selected.includes(call)) continue;
    const missing = claims.filter((claim) => !visible.some((source) => shows(claim, source)));
    const output = figureWindows(call.output, missing, 0, Math.min(WINDOW_BUDGET, remaining));
    if (!output) continue;
    outputs.push({ call, output, supplementary: true });
    visible = [...visible, ...excerptFigures(output)];
    remaining -= output.length;
  }
  return outputs;
}

export interface HiddenJudgeFigure {
  figure: Figure;
  cause: "head_cut" | "call_filtered";
  recovered: boolean;
  sources: Array<{ toolCallId: string; toolName: string; index: number; context: string }>;
}

/** Value overlap is a candidate visibility problem, not proof of grounding or of a wrong grade. */
export function auditJudgeEvidence(calls: ToolCallTrace[], answerAndReport: string): HiddenJudgeFigure[] {
  const candidates = successfulEvidenceCalls(calls);
  const selected = headCalls(candidates);
  const oldFigures = selected.flatMap((call) => excerptFigures(truncateToolOutput(call.output)));
  const newFigures = judgeEvidenceOutputs(calls, answerAndReport).flatMap(({ output }) => excerptFigures(output));
  const sourceFigures = candidates.map((call) => ({ call, figures: excerptFigures(call.output) }));
  return uniqueClaims(answerAndReport).flatMap((figure) => {
    if (oldFigures.some((source) => shows(figure, source))) return [];
    const sources = sourceFigures.flatMap(({ call, figures }) => figures.filter((source) => matches(figure, source)).map((source) => ({
      toolCallId: call.toolCallId, toolName: call.toolName, index: source.index,
      context: call.output.slice(Math.max(0, source.index - CONTEXT), source.index + source.raw.length + CONTEXT),
    })));
    if (!sources.length) return [];
    const inSelected = selected.some((call) => sources.some((source) => source.toolCallId === call.toolCallId));
    return [{ figure, cause: inSelected ? "head_cut" as const : "call_filtered" as const,
      recovered: newFigures.some((source) => shows(figure, source)), sources }];
  });
}
