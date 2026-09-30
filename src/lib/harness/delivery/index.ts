import { assistantText } from "@/lib/agent/messages";
import { currentTurnStart } from "@/lib/context/stubs";
import { specFromAnswer } from "@/lib/reports/from-answer";
import { publishReport, reportDetails } from "@/lib/reports/publish";
import { templateById } from "@/lib/reports/templates";
import { REPORT_TOOL } from "@/lib/reports/tool-name";
import { nextCheckId, recordCheck, type Concern, type TurnState } from "../concern";
import { resolveProse } from "@/lib/reports/references";
import { looksLikeAnalysis, resolveDelivery } from "./resolve";

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
    if (d?.mode === "auto" && d.stage === "pending" && !turn.final && turn.availableTools?.includes(REPORT_TOOL) !== false) {
      const draft = messages.slice(currentTurnStart(messages)).findLast((message) => message.role === "assistant");
      const shape = looksLikeAnalysis(assistantText(draft));
      if (shape) { d.mode = "report"; d.why = `Analysis was already drafted: ${shape}`; }
    }
    return messages;
  },
  turnNote: ({ delivery: d, final }) => {
    if (!d) return undefined;
    if (final && d.stage !== "created") return "Finish in chat from the verified evidence already gathered. Report delivery cannot continue.";
    if (d.stage === "created") return "The report is final and no tool is available this turn; qualify any figure listed under its Verification notes in prose, never recompute it or send it again. Close with a self-contained conclusion of at most 200 words: the decisive findings, why they matter for the user's question, and remaining uncertainty, reusing the report's verified claims without new analysis.";
    if (d.mode === "report") return `Report pending: this turn ends with ${REPORT_TOOL}${d.template ? `(template: ${d.template})` : ""}; write no analysis in chat before it.`;
    if (d.mode === "auto") return `Choose before writing: a comparison, table or substantive analysis goes directly into ${REPORT_TOOL}; a quick fact or clarification stays in chat. Do not write an analysis twice.`;
    return "The user requested chat. Answer this turn's question briefly with evidence ids, keeping its requested scope and length.";
  },
  tools: (tools, { delivery: d }) =>
    d?.stage === "created" ? [] : d?.mode === "chat" ? tools.filter((t) => t.name !== REPORT_TOOL) : tools,
  beforeTool: (call, { delivery: d }) => {
    if (d?.stage === "created") return { block: true, reason: "The report is complete. Finish in chat from its verified findings; no further tools are available this turn." };
    if (call.name === REPORT_TOOL && d?.mode === "chat") return { block: true, reason: "Finish this answer in chat; no further report is needed." };
  },
  toolResult: (call, result, { delivery: d }) => {
    if (call.name !== REPORT_TOOL || !d) return;
    if (d.mode === "auto") { d.mode = "report"; d.why = "The agent started a report."; }
    if (!result.isError) d.stage = "created";
  },
  beforeRunEnd: (answer, { delivery: d, ledger }) => {
    // References the ledger resolves are rewritten at turn end; only unresolvable ones need the model.
    const { problems } = resolveProse(answer, ledger);
    if (problems.length) return { rule: "delivery", kind: "follow_up", reason: "The chat answer contains evidence placeholders",
      text: problems.map((p) => p.message).join("\n") + "\nWrite the answer with actual values and [id] citations. Where a value is already written, cite it without repeating it. State unavailable values as unavailable. Preserve the user's scope and length; omit correction commentary and reference placeholders." };
    const shape = missedReport(answer, d);
    if (!shape) return undefined;
    return { rule: "delivery", kind: "follow_up", reason: `No report was created: ${shape}`,
      text: `Deliver this analysis with ${REPORT_TOOL}${d?.template ? ` (template ${d.template})` : ""}. Move the draft into sections and blocks with evidence references; do not write it out again in chat. Then give a concise conclusion with the decisive evidence and its citations.` };
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
    const shape = index === -1 || answer.role !== "assistant" || !missedReport(assistantText(answer), d) ? undefined : looksLikeAnalysis(assistantText(answer));
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

/** The shape of an analysis that should have been a report, or nothing when delivery is satisfied. */
function missedReport(answer: string, d: TurnState["delivery"]): string | undefined {
  if (!d || d.mode === "chat" || d.stage === "created") return undefined;
  return d.mode === "report" ? d.why : looksLikeAnalysis(answer);
}
