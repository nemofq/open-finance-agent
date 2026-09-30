import type { Context } from "@earendil-works/pi-ai";
import { jsonrepair } from "jsonrepair";
import { z } from "zod";
import type { AppConfig, ModelRef, ThinkingLevel } from "@/lib/config/schema";
import { KIND_CLASS } from "@/lib/evidence/ids";
import type { EvidenceEntry } from "@/lib/evidence/types";
import { resolveModel } from "@/lib/llm";
import { modelRefKey } from "@/lib/llm/catalog";
import { streamModel } from "@/lib/llm/stream";
import type { CheckRecord } from "@/lib/policy/types";
import type {
  DeterministicCheckResult,
  EvalTask,
  JudgeEvaluationResult,
  OfflineAudit,
  OfflineAuditKind,
  ToolCallTrace,
} from "../types";

/** Versioned judge prompt configuration for evaluation runs. */
export const JUDGE_PROMPT_VERSION = "7";

/** Boundary lines the judge sees; the rest are counted, not listed. */
const BOUNDARY_LINES = 15;

/** Characters of each tool output the judge sees. Long filings are truncated, tags are not. */
const OUTPUT_BUDGET = 4_000;

/** `[E7]`, `[C3, E1]`: an evidence tag line must survive truncation, wherever it sits. */
export const EVIDENCE_TAG = new RegExp(String.raw`\[${KIND_CLASS}\d+(?:\s*,\s*${KIND_CLASS}\d+)*\]`);

const JUDGE_SYSTEM_PROMPT = `You are a Senior Financial Analyst and Rigorous Evaluator assessing an AI Financial Research Agent for retail investors.
Your job is to evaluate the agent's response to an ambiguous, complex retail investor query against the data its tools actually returned, the user's latent intent, and a specific 4-dimension rubric.

Be fair, rigorous, and critical:
- Did the agent identify the real underlying question and any cognitive biases (e.g. FOMO, yield traps, beat-and-drop confusion)?
- Is every figure in the answer supported by the tool outputs and the evidence index below? Penalise numbers that appear nowhere in the retrieved data.
- Did it explain the financial mechanics without making prohibited, unhedged personal buy/sell investment advice?
- The agent was pinned to the as-of date given below. Judge it on what was knowable then, and penalise anything dated after it.

Respond ONLY with a valid JSON object matching the required schema. Plain JSON is preferred; a single \`\`\`json fenced block is accepted.`;

const JUDGE_REPAIR_SYSTEM_PROMPT = `You repair the shape of a financial-evaluation JSON object.
Do not re-evaluate the answer and do not change any valid numeric score or existing feedback.
Map semantically equivalent feedback keys to the required keys. If overallVerdict is missing, write
a concise summary of the existing dimension feedback. Return only the complete JSON object.`;

/**
 * Keep the head of an output, and append any evidence-tag lines the head cut off, so the judge can
 * always see which entries a result registered even when the body is long.
 */
export function truncateToolOutput(text: string, budget: number = OUTPUT_BUDGET): string {
  if (text.length <= budget) return text;

  const head = text.slice(0, budget);
  const tail = text.slice(budget);
  const tagLines = tail
    .split("\n")
    .filter((line) => EVIDENCE_TAG.test(line))
    .slice(0, 20);

  const omitted = `… [${text.length - budget} more characters omitted]`;
  return [head, omitted, ...tagLines].join("\n");
}

function renderToolCalls(toolCalls: ToolCallTrace[]): string {
  if (toolCalls.length === 0) return "(No tools called)";
  return toolCalls
    .map((call, index) => {
      const failure = call.isError ? " — FAILED" : "";
      const header = `#${index + 1} ${call.toolName}(${JSON.stringify(call.args)})${failure}`;
      return `${header}\nOutput:\n${truncateToolOutput(call.output) || "(empty)"}`;
    })
    .join("\n\n");
}

/** One line per ledger entry: what it is, where it came from and when it was true. */
export function renderEvidenceIndex(entries: EvidenceEntry[]): string {
  if (entries.length === 0) return "(No evidence entries recorded)";
  return entries
    .map((entry) => {
      const source = entry.source ? `${entry.source.name} (tier ${entry.source.tier})` : "no source";
      const asOf = entry.asOf ? `as-of ${entry.asOf}` : "no as-of date";
      return `- ${entry.id} · ${source} · ${asOf}${entry.lookAhead ? " · LOOK-AHEAD" : ""} · ${entry.summary}`;
    })
    .join("\n");
}

export function renderChecks(checks: CheckRecord[]): string {
  if (checks.length === 0) return "(No enforcement checks recorded)";
  return checks
    .map((check) => {
      const resolution = check.resolved === undefined ? "" : check.resolved ? " (resolved)" : " (unresolved)";
      return `- ${check.rule} ${check.kind}${check.enforced ? "" : " (observed only)"}${resolution}: ${check.reason}`;
    })
    .join("\n");
}

/** Audit kinds that mark the edge of the closed world; empty results are ordinary observations. */
const BOUNDARY_KINDS: Partial<Record<OfflineAuditKind, string>> = {
  out_of_scope: "out of scope",
  out_of_scope_query: "out of scope",
  not_captured: "not captured",
  not_available_as_of: "future-blocked",
};

function boundaryRequest(event: OfflineAudit["events"][number]): string {
  const text = event.urls?.length ? event.urls.join(", ") : JSON.stringify(event.normalizedRequest ?? {});
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

/**
 * The requests the offline dataset refused, one line each: which tool, what was asked and why it
 * was unavailable. Duplicates collapse and the list is capped, so a model that retried the same
 * URL twenty times does not bury the rest of the prompt.
 */
export function renderDataBoundary(audit: OfflineAudit | undefined): string | undefined {
  if (!audit) return undefined;
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const event of audit.events) {
    const label = BOUNDARY_KINDS[event.kind];
    if (!label) continue;
    const line = `- ${label} · ${event.tool} · ${boundaryRequest(event)}`;
    if (seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }
  if (lines.length === 0) return undefined;
  const shown = lines.slice(0, BOUNDARY_LINES);
  if (lines.length > BOUNDARY_LINES) shown.push(`- … ${lines.length - BOUNDARY_LINES} more unavailable request(s) not listed`);
  return shown.join("\n");
}

export interface JudgeInput {
  task: EvalTask;
  toolCalls: ToolCallTrace[];
  evidence: EvidenceEntry[];
  checks: CheckRecord[];
  finalAssistantText: string;
  deterministicCheck: DeterministicCheckResult;
  /** The offline dataset's audit for this task, when the run used it. */
  offlineAudit?: OfflineAudit;
}

export function buildJudgePrompt(input: JudgeInput): string {
  const { task } = input;
  const prompts = [task.prompt, ...(task.followUpPrompts ?? [])];
  const boundary = renderDataBoundary(input.offlineAudit);
  const boundaryBlock = boundary === undefined ? "" : `### Offline Data Boundary
The agent ran against a closed offline dataset. These requests were refused because the data was outside the task's corpus, was never captured, or is dated after the as-of date:
${boundary}
Do not penalise the absence of a comparison or figure that this boundary made unavailable, provided the answer does not pretend to have it. Do penalise any claim that ignores the boundary, such as quoting or characterising a future-blocked figure or presenting a refused source's contents as known.

`;
  return `### Task Information
- Task ID: ${task.id}
- Title: ${task.title}
- As-Of Date (the agent knew nothing after this date): ${task.asOfDate}
- Conversation Prompts (the final response answers the last prompt):
${prompts.map((prompt, index) => `${index + 1}. ${JSON.stringify(prompt)}`).join("\n")}
- Latent Intent (Hidden Ground Truth Context): ${task.latentIntent}

### Rubric Guidelines
1. Intent Recognition (0-15 pts): ${task.rubric.intentScoreCriteria}
2. Financial Analysis Soundness (0-20 pts): ${task.rubric.financialReasoningCriteria}
3. Data Grounding & Factual Citations (0-15 pts): ${task.rubric.dataGroundingCriteria}
4. Retail Investor Clarity & Guardrails (0-10 pts): ${task.rubric.retailClarityCriteria}

### Tool Calls and Their Outputs (${input.toolCalls.length})
${renderToolCalls(input.toolCalls)}

### Evidence Index (${input.evidence.length} entries)
${renderEvidenceIndex(input.evidence)}

${boundaryBlock}### Enforcement Checks
Checks are historical events. A resolved check records a later correction; verify the final answer and evidence before penalizing it. Missing resolution status means unknown, not unresolved.
${renderChecks(input.checks)}

### Deterministic Checks
- Score: ${input.deterministicCheck.score} / ${input.deterministicCheck.maxScore}
- Notes: ${input.deterministicCheck.details.join("; ")}

### Agent Final Response
${input.finalAssistantText || "(No reply generated)"}

### Output Requirements
Evaluate the response and output strictly a JSON object with this exact structure:
{
  "intentScore": <integer 0-15>,
  "intentFeedback": "<detailed justification>",
  "financialScore": <integer 0-20>,
  "financialFeedback": "<detailed justification>",
  "groundingScore": <integer 0-15>,
  "groundingFeedback": "<detailed justification>",
  "retailClarityScore": <integer 0-10>,
  "retailClarityFeedback": "<detailed justification>",
  "overallVerdict": "<concise 2-3 sentence executive summary of response quality>"
}`;
}

/** Every failure mode returns a zero-scored result with `error` set, so one bad grade never kills a run. */
function failed(judgeModel: string, message: string, verdict = message): JudgeEvaluationResult {
  return {
    intentScore: 0,
    intentFeedback: message,
    financialScore: 0,
    financialFeedback: message,
    groundingScore: 0,
    groundingFeedback: message,
    retailClarityScore: 0,
    retailClarityFeedback: message,
    totalJudgeScore: 0,
    maxJudgeScore: 60,
    overallVerdict: verdict,
    judgeModel,
    promptVersion: JUDGE_PROMPT_VERSION,
    error: message,
  };
}

/**
 * `thinking` is `--judge-thinking`: sent as the reasoning level of both the grading and the format
 * repair request. Unset or off sends none, which is how every judge ran before the flag, so runs
 * without it stay comparable.
 */
export async function evaluateWithJudge(
  input: JudgeInput,
  config: AppConfig,
  judgeRef: ModelRef,
  thinking?: ThinkingLevel,
): Promise<JudgeEvaluationResult> {
  const label = modelRefKey(judgeRef);
  const reasoning = thinking && thinking !== "off" ? { reasoning: thinking } : {};
  const resolution = await resolveModel(config, judgeRef);
  if (!resolution.ok) return failed(label, `Judge model unavailable: ${resolution.message}`);

  const context: Context = {
    systemPrompt: JUDGE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildJudgePrompt(input), timestamp: Date.now() }],
  };

  try {
    const response = await streamModel(config, resolution.model, context, {
      timeoutMs: 120_000,
      maxTokens: 4096,
      ...reasoning,
    }).result();

    if (response.stopReason === "error") throw new Error(response.errorMessage || "Judge model execution error");

    const rawText = response.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("")
      .trim();

    const parsed = parseJudgeJson(rawText, label);
    if (!parsed.error) return parsed;

    // One format-only retry keeps malformed judge output auditable without giving the judge a
    // second chance to change the substantive grade.
    const repairContext: Context = {
      systemPrompt: JUDGE_REPAIR_SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: `Repair this invalid judge object without changing valid scores or feedback.\n\nValidation error: ${parsed.error}\n\n${rawText}\n\nReturn exactly the nine required rubric keys as JSON.`,
        timestamp: Date.now(),
      }],
    };
    const repairedResponse = await streamModel(config, resolution.model, repairContext, {
      timeoutMs: 120_000,
      maxTokens: 4096,
      ...reasoning,
    }).result();
    if (repairedResponse.stopReason === "error") throw new Error(repairedResponse.errorMessage || "Judge format repair execution error");
    const repairedText = repairedResponse.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("")
      .trim();
    const repaired = parseJudgeJson(repairedText, label);
    return { ...repaired, repairAttempted: true, initialRawResponse: rawText };
  } catch (err) {
    return failed(label, `Judge execution error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Reasoning models wrap their answer in `<think>` blocks and often fence the JSON; some emit both,
 * and some emit a closing `</think>` with no opening tag. Take the text after the last `</think>`,
 * then the last fenced block that parses, then the first balanced object that parses.
 */
export function extractJudgeJson(rawText: string): string | null {
  const closing = rawText.lastIndexOf("</think>");
  let text = closing === -1 ? rawText : rawText.slice(closing + "</think>".length);
  // An unterminated <think> means everything after it is reasoning, not an answer.
  const opening = text.indexOf("<think>");
  if (opening !== -1) text = text.slice(0, opening);

  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1].trim());
  for (const candidate of fenced.reverse()) {
    if (parsedObject(candidate)) return candidate;
  }

  for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
    const candidate = balancedObject(text, start);
    if (candidate && parsedObject(candidate)) return candidate;
  }
  return null;
}

function parsedObject(candidate: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(candidate);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    try {
      const repaired = jsonrepair(candidate);
      const value: unknown = JSON.parse(repaired);
      return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
}

/** The substring from `start` to its matching brace, ignoring braces inside JSON strings. */
function balancedObject(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

const feedback = z.string().trim().min(1);
const judgeRubric = z.object({
  intentScore: z.number().int().min(0).max(15),
  intentFeedback: feedback,
  financialScore: z.number().int().min(0).max(20),
  financialFeedback: feedback,
  groundingScore: z.number().int().min(0).max(15),
  groundingFeedback: feedback,
  retailClarityScore: z.number().int().min(0).max(10),
  retailClarityFeedback: feedback,
  overallVerdict: feedback,
});

export function parseJudgeJson(rawText: string, judgeModel: string): JudgeEvaluationResult {
  const json = extractJudgeJson(rawText);
  const parsed = json ? parsedObject(json) : null;
  if (!parsed) return { ...failed(judgeModel, "Invalid JSON response from judge", rawText.slice(0, 300)), rawResponse: rawText };

  const validated = judgeRubric.safeParse(parsed);
  if (!validated.success) {
    const issues = validated.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    return { ...failed(judgeModel, `Invalid judge rubric: ${issues}`), rawResponse: rawText };
  }
  const { intentScore, financialScore, groundingScore, retailClarityScore } = validated.data;

  return {
    ...validated.data,
    totalJudgeScore: intentScore + financialScore + groundingScore + retailClarityScore,
    maxJudgeScore: 60,
    judgeModel,
    promptVersion: JUDGE_PROMPT_VERSION,
    rawResponse: rawText,
  };
}
