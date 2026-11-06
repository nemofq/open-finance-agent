import { assistantText } from "@/lib/agent/messages";
import { CALCULATOR_TOOL } from "@/lib/calculator/tool-name";
import { currentTurnStart } from "@/lib/context/stubs";
import { specFromAnswer } from "@/lib/reports/from-answer";
import { publishReport, reportDetails } from "@/lib/reports/publish";
import { templateById } from "@/lib/reports/templates";
import { REPORT_TOOL } from "@/lib/reports/tool-name";
import { nextCheckId, recordCheck, type Concern, type TurnState } from "../concern";
import { resolveProse } from "@/lib/reports/references";
import { looksLikeAnalysis, resolveDelivery } from "./resolve";

const CLOSE_AFTER_REPORT = "Close with a self-contained conclusion of at most 200 words: the decisive findings, why they matter for the user's question, and remaining uncertainty, reusing the report's verified claims without new analysis, in any answer format the user asked for.";

/** How the check that asks an automatic turn to choose its channel names itself; the record is the state. */
const CHOICE_REASON = "Asked to choose report or chat:";

/**
 * An automatic turn whose draft read like an analysis was asked, once, whether the user wanted a
 * report or an answer in chat. The model knows which the user asked for better than a figure count
 * does, so whatever it answers then stands: no second ask, no switch to report mode, no rendering.
 */
const choiceAsked = ({ delivery: d, checks }: TurnState): boolean =>
  d?.mode === "auto" && checks.some((check) => check.rule === "delivery" && check.kind === "follow_up" && check.enforced && check.reason.startsWith(CHOICE_REASON));

/** A correction since the report told the model to compute a figure, so the calculator stays offered. */
const calculatorAsked = ({ delivery: d, final, checks }: TurnState): boolean =>
  !final && d?.stage === "created" &&
  checks.slice(d.checksAtReport).some((check) => check.kind === "follow_up" && check.text?.includes(CALCULATOR_TOOL));

/**
 * Delivery owns intent, progress and the available report actions. A promised report is asked
 * for once at stop time; if the turn still ends without one, the answer itself is rendered as
 * the report, so delivery is the loop's guarantee rather than the model's.
 */
export const delivery: Concern = {
  name: "delivery",
  promptSection: () =>
    `Substantive analysis is delivered with ${REPORT_TOOL}; the chat reply gives its conclusion, decisive evidence and limits. Quick facts, clarifications and follow-ups stay in chat. Choose the channel before composing the answer.`,
  beforeTurn: (turn) => { turn.delivery = resolveDelivery({ request: turn.request, skill: turn.skill }); },
  transformContext: (messages, turn) => {
    const d = turn.delivery;
    if (d?.mode === "auto" && d.stage === "pending" && !turn.final && !choiceAsked(turn) && turn.availableTools?.includes(REPORT_TOOL) !== false) {
      const draft = messages.slice(currentTurnStart(messages)).findLast((message) => message.role === "assistant");
      const shape = looksLikeAnalysis(assistantText(draft));
      if (shape) { d.mode = "report"; d.why = `Analysis was already drafted: ${shape}`; }
    }
    return messages;
  },
  turnNote: (turn) => {
    const { delivery: d, final } = turn;
    if (!d) return undefined;
    if (final && d.stage !== "created") return "Finish in chat from the verified evidence already gathered. Report delivery cannot continue.";
    if (calculatorAsked(turn)) return `The report is final; do not send it again. ${CALCULATOR_TOOL} is the only tool available this turn, for a missing figure the correction names. ${CLOSE_AFTER_REPORT}`;
    if (d.stage === "created") return `The report is final and no tool is available this turn; qualify any figure listed under its Verification notes in prose, never recompute it or send it again. ${CLOSE_AFTER_REPORT}`;
    if (d.mode === "report") return `Report pending: this turn ends with ${REPORT_TOOL}${d.template ? `(template: ${d.template})` : ""}; write no analysis in chat before it.`;
    if (d.mode === "auto") return `Choose before writing: a comparison, table or substantive analysis goes directly into ${REPORT_TOOL}; a quick fact or clarification stays in chat. Do not write an analysis twice.`;
    return "The user requested chat. Answer this turn's question briefly with evidence ids, keeping its requested scope and length.";
  },
  tools: (tools, turn) => {
    const d = turn.delivery;
    if (d?.stage === "created") return calculatorAsked(turn) ? tools.filter((t) => t.name === CALCULATOR_TOOL) : [];
    return d?.mode === "chat" ? tools.filter((t) => t.name !== REPORT_TOOL) : tools;
  },
  beforeTool: (call, turn) => {
    const d = turn.delivery;
    if (d?.stage === "created" && !(call.name === CALCULATOR_TOOL && calculatorAsked(turn))) return { block: true, reason: "The report is complete. Finish in chat from its verified findings; no further tools are available this turn." };
    if (call.name === REPORT_TOOL && d?.mode === "chat") return { block: true, reason: "Finish this answer in chat; no further report is needed." };
  },
  toolResult: (call, result, { delivery: d, checks }) => {
    if (call.name !== REPORT_TOOL || !d) return;
    if (d.mode === "auto") { d.mode = "report"; d.why = "The agent started a report."; }
    if (!result.isError) { d.stage = "created"; d.checksAtReport = checks.length; }
  },
  beforeRunEnd: (answer, turn) => {
    const { delivery: d, ledger } = turn;
    // References the ledger resolves are rewritten at turn end; only unresolvable ones need the model.
    const { problems } = resolveProse(answer, ledger);
    if (problems.length) return { rule: "delivery", kind: "follow_up", reason: "The chat answer contains evidence placeholders",
      text: problems.map((p) => p.message).join("\n") + "\nWrite the answer with actual values and [id] citations. Where a value is already written, cite it without repeating it. State unavailable values as unavailable. Preserve the user's scope and length; omit correction commentary and reference placeholders." };
    const shape = missedReport(answer, turn);
    if (!shape) return undefined;
    const conclude = "Then give a concise conclusion with the decisive evidence and its citations, keeping any answer format the user asked for (such as a required final line).";
    if (d?.mode === "auto") {
      return { rule: "delivery", kind: "follow_up", reason: `${CHOICE_REASON} ${shape}`,
        text: `Your draft reads like an analysis (${shape}). Decide how to deliver it from what the user asked. If they asked for an analysis, a comparison or a report, deliver it with ${REPORT_TOOL}: move the draft into sections and blocks with evidence references, without writing it out again in chat. ${conclude} If they asked for a specific value or a short answer, keep the answer in chat instead, in the format they asked for. Do not mention this check.` };
    }
    return { rule: "delivery", kind: "follow_up", reason: `No report was created: ${shape}`,
      text: `Deliver this analysis with ${REPORT_TOOL}${d?.template ? ` (template ${d.template})` : ""}. Move the draft into sections and blocks with evidence references; do not write it out again in chat. ${conclude}` };
  },
  afterTurn: async (messages, turn) => {
    const d = turn.delivery;
    const start = currentTurnStart(messages);
    const index = messages.findLastIndex((message, i) => i >= start && message.role === "assistant" && assistantText(message).trim() !== "");
    const answer = messages[index];
    // The harness resolves its own reference syntax in place: the accepted answer is this same message.
    if (answer?.role === "assistant") {
      const rewrites = answer.content.map((b) => b.type === "text" ? resolveProse(b.text, turn.ledger) : undefined);
      const used = [...new Set(rewrites.flatMap((r) => r?.used ?? []))];
      if (used.length) {
        answer.content = answer.content.map((b, i) => {
          const rewrite = rewrites[i];
          return b.type === "text" && rewrite ? { ...b, text: rewrite.text } : b;
        });
        recordCheck(turn, { rule: "delivery", kind: "annotate", reason: "Evidence placeholders resolved by the harness", evidence: used }, "before_stop");
      }
    }
    // Only an answer with a report's substance is worth rendering; an apology or a short reply is not.
    const shape = index === -1 || answer.role !== "assistant" || !missedReport(assistantText(answer), turn) ? undefined : looksLikeAnalysis(assistantText(answer));
    if (!shape || !d || answer?.role !== "assistant") return;
    // The call id names the check that explains it; the R entry carries it so later turns stub the spec.
    const id = `harness-${nextCheckId(turn)}`;
    const report = await publishReport(specFromAnswer(assistantText(answer), turn.request.slice(0, 80) || "Analysis"), turn.ledger,
      { defaultFormat: "doc", template: templateById(d.template), toolCallId: id }).catch(() => undefined);
    if (!report) return;
    // The transcript, the panel and the next turn all find reports on a create_report result.
    const check = recordCheck(turn, { rule: "delivery", kind: "flag", reason: `Report rendered from the chat answer: ${shape}` }, "before_stop");
    const { api, provider, model, usage } = answer;
    messages.splice(index, 0,
      { role: "assistant", api, provider, model, usage, stopReason: "toolUse", timestamp: check.timestamp,
        content: [{ type: "toolCall", id, name: REPORT_TOOL, arguments: report.spec }] },
      { role: "toolResult", toolCallId: id, toolName: REPORT_TOOL, isError: false, timestamp: check.timestamp,
        content: [{ type: "text", text: `${report.stub}\nThe report was rendered from the chat answer.` }],
        details: { ...reportDetails(report), rendered: "answer" } });
    d.stage = "created";
    d.why = `Rendered from the chat answer: ${shape}`;
  },
};

/**
 * The shape of an analysis that should have been a report, or nothing when delivery is satisfied.
 * An automatic turn already asked to choose is satisfied by whatever the model chose.
 */
function missedReport(answer: string, turn: TurnState): string | undefined {
  const d = turn.delivery;
  if (!d || d.mode === "chat" || d.stage === "created" || choiceAsked(turn)) return undefined;
  return d.mode === "report" ? d.why : looksLikeAnalysis(answer);
}
