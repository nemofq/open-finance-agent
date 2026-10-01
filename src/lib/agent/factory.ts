import { Agent } from "@earendil-works/pi-agent-core";
import { resolveContextBudget } from "@/lib/context/budget";
import { summarizer } from "@/lib/context/compact";
import type { CompactionMessage, ContextUsage } from "@/lib/context/types";
import type { EvidenceLedger } from "@/lib/evidence/types";
import { attachments } from "@/lib/harness/attachments";
import { capabilities } from "@/lib/harness/capabilities";
import { compaction } from "@/lib/harness/compaction";
import { compose, type Composed, FOLLOW_UP_BUDGET, type TurnState } from "@/lib/harness/concern";
import { conduct } from "@/lib/harness/conduct";
import { delivery } from "@/lib/harness/delivery";
import { evidence, openSessionLedger } from "@/lib/harness/evidence";
import { policy, ruleContext } from "@/lib/harness/policy";
import { time as timeConcern } from "@/lib/harness/time";
import { user } from "@/lib/harness/user";
import { view } from "@/lib/harness/view";
import { resolutionCode, resolveModel } from "@/lib/llm";
import { formatProfileForPrompt } from "@/lib/profile/prompt";
import { readProfile } from "@/lib/profile/store";
import type { ModuleContext, TurnKind } from "@/lib/tools/contracts";
import { type Execution, execution } from "./execution";
import { getSkill } from "@/lib/skills/loader";
import type { Skill } from "@/lib/skills/skill";
import { isSandboxAvailable, warmSandbox } from "@/lib/sandbox";
import { AgentConfigError, imagesUnsupportedMessage } from "./config-error";
import { withoutSystemMessages } from "./messages";
import { collectTools, enabledModules, isEnabled, memoryForPrompt, privacySummary, sessionDocuments, skillsForPrompt } from "./modules";
import type { TurnInput } from "./turn-types";

export interface AgentListeners {
  onUsage?: (usage: ContextUsage) => void;
  onCompaction?: (message: CompactionMessage) => void;
}

/** What a turn hands the factory: most of its own input, with the request text and the turn's kind. */
export type CreateAgentOptions = Pick<TurnInput, "execution" | "config" | "session" | "time" | "skill" | "images" | "documents" | "policyMode" | "wrapTool" | "keepTool" | "profileBlock"> & {
  request?: string;
  turn?: TurnKind;
  listeners?: AgentListeners;
};

export interface BuiltAgent {
  execution: Execution;
  agent: Agent;
  ledger: EvidenceLedger;
  composed: Composed;
  turn: TurnState;
  /** The skill the turn was asked to run, loaded once here; absent when none was asked for, or it is gone. */
  skill?: Skill;
}

export async function buildAgent(options: CreateAgentOptions): Promise<BuiltAgent> {
  const { config, session, time, listeners = {} } = options;
  if (isEnabled(config, "python")) warmSandbox();
  const resolved = await resolveModel(config, session.model, { heldBy: "chat" });
  if (!resolved.ok) {
    throw new AgentConfigError(resolved.message, resolutionCode(resolved.reason));
  }
  if (options.images?.length && !resolved.model.input.includes("image")) {
    throw new AgentConfigError(imagesUnsupportedMessage(resolved.provider.type, resolved.info.name || resolved.model.id), "images_unsupported");
  }
  const profile = await readProfile();
  const ledger = await openSessionLedger(session.id, session.messages);
  const documents = sessionDocuments(session.messages, options.documents);
  const ctx: ModuleContext = { log: (msg) => console.log(`[module] ${msg}`),
    asOf: time.asOf, localDate: time.localDate, session: { id: session.id }, documents,
    turn: options.turn ?? { kind: "interactive" }, evidence: ledger };
  const [memory, skillsIndex, collected, privacy, skill] = await Promise.all([
    memoryForPrompt(config), skillsForPrompt(config), collectTools(config, enabledModules(config), ctx),
    privacySummary(config, time.localDate), options.skill ? getSkill(options.skill) : undefined,
  ]);
  const tools = options.keepTool ? collected.filter(options.keepTool) : collected;
  const calculatorAvailable = isEnabled(config, "python") && isSandboxAvailable();
  const budget = resolveContextBudget(resolved.model);
  const turn: TurnState = { ledger, time, request: options.request ?? "",
    skill: skill ? { name: skill.name, output: skill.metadata?.output } : undefined,
    followUpsLeft: FOLLOW_UP_BUDGET, checks: [], mode: options.policyMode ?? "enforce" };
  const rules = ruleContext(turn, { tools, profile, privacy, calculatorAvailable,
    tickers: session.tickers ?? [], now: Date.now }, session.messages);
  const run = execution(config, turn, options.execution);
  const composed = compose([
    { name: "execution", beforeTool: run.beforeTool, toolResult: run.toolResult, wrapTool: run.guard },
    timeConcern, capabilities(calculatorAvailable), user(rules), attachments(session.id, resolved.model, options.documents),
    conduct, evidence, delivery, policy(rules),
    compaction({ budget, summarize: summarizer((context) => run.stream(resolved.model, context, { conversationId: session.id })), onCompaction: (message, messages) => { agent.state.messages = messages; listeners.onCompaction?.(message); }, onUsage: listeners.onUsage }),
    view(budget, listeners.onUsage), ...(options.wrapTool ? [{ name: "telemetry", wrapTool: options.wrapTool }] : []),
  ], { tools, skillsIndex, memory, profileBlock: options.profileBlock ?? (profile ? formatProfileForPrompt(profile) : undefined) }, turn);
  // pi puts a system message with the prompt and the tools ahead of the saved chat, which never
  // holds one: a stray one would take its place. Every request is still built by `requestContext`.
  const agent = new Agent({ ...composed.agentOptions,
    initialState: { systemPrompt: composed.systemPrompt, model: resolved.model,
      thinkingLevel: config.llm.thinkingLevel, tools: composed.wrapTools(tools), messages: withoutSystemMessages(session.messages) },
    streamFn: (model, context, streamOptions) => run.stream(model, composed.requestContext(context), streamOptions),
    sessionId: session.id,
  });
  composed.bind(agent);
  return { agent, ledger, composed, turn, execution: run, skill };
}
