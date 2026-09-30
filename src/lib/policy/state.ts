import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { EvidenceEntry } from "@/lib/evidence/types";
import { blockText } from "@/lib/text/blocks";
import type { FinanceTool } from "@/lib/tools/contracts";
import { companyKey, dataSourceOf, findTool, tickerFromArgs } from "./args";
import type { ConflictNote, PolicyState } from "./types";

/**
 * The run's state. The policy concern owns it, so the rules themselves stay pure: connections
 * tried in this chat are rebuilt from the transcript, and everything else accrues during the run.
 */

function add(index: Map<string, Set<string>>, key: string, id: string): void {
  const ids = index.get(key) ?? new Set<string>();
  ids.add(id);
  index.set(key, ids);
}

export function createState(): PolicyState {
  return {
    connectionsTried: new Map(),
    connectionsFailed: new Map(),
    conflicts: [],
    attempted: new Set(),
  };
}

/**
 * A connection reports some failures in the body with a successful status: Alpha Vantage answers
 * a spent rate limit with a JSON note. Until every module throws on those, a result carrying one
 * counts as a connection tried and found wanting.
 */
const IN_BAND_ERRORS: readonly RegExp[] = [
  /"error"\s*:\s*[{"]/,
  /"Error Message"\s*:/,
  /"(?:Note|Information)"\s*:\s*"[^"]*(?:call frequency|rate limit|premium endpoint)/i,
];

export function isInBandError(text: string): boolean {
  return IN_BAND_ERRORS.some((pattern) => pattern.test(text));
}

/**
 * Every tool call the model issued this turn counts as attempted, in the order it was issued and
 * whatever became of it: allowed, blocked or served by any rule or concern, failed, or empty. A
 * "use X first" block lifts on it (engine), so it must not depend on how X's call was handled.
 */
export function recordToolIssued(state: PolicyState, name: string): void {
  state.attempted.add(name);
}

/** Records a data source connection as attempted once the tool call is permitted. */
export function recordConnectionAttempt(state: PolicyState, tool: FinanceTool | undefined, args: unknown): void {
  const source = dataSourceOf(tool);
  if (!source) return;
  add(state.connectionsTried, companyKey(tickerFromArgs(args)), source.id);
}

/** Records data source connection outcome, tracking whether data was returned. */
function recordConnection(
  state: PolicyState,
  tool: FinanceTool | undefined,
  args: unknown,
  isError: boolean,
  text: string,
): void {
  const source = dataSourceOf(tool);
  if (!source) return;
  const key = companyKey(tickerFromArgs(args));
  add(state.connectionsTried, key, source.id);
  if (isError || text.trim() === "" || isInBandError(text)) add(state.connectionsFailed, key, source.id);
}

/** The connections this chat has already tried, read back from the transcript's tool calls. */
export function rebuildState(messages: AgentMessage[], tools: FinanceTool[]): PolicyState {
  const state = createState();
  const calls = new Map<string, { name: string; args: unknown }>();

  for (const message of messages) {
    if (message.role === "assistant") {
      for (const block of message.content) {
        if (block.type === "toolCall") calls.set(block.id, { name: block.name, args: block.arguments });
      }
    } else if (message.role === "toolResult") {
      const call = calls.get(message.toolCallId);
      const tool = findTool(tools, message.toolName || (call?.name ?? ""));
      recordConnection(state, tool, call?.args, message.isError, blockText(message.content, "\n"));
    }
  }
  return state;
}

/** A tool call that has run, as the state folds it in. */
export interface FinishedCall {
  tool?: FinanceTool;
  toolName: string;
  args: unknown;
  isError: boolean;
  text: string;
  entry?: EvidenceEntry;
}

function sameConflict(a: ConflictNote, b: ConflictNote): boolean {
  return a.entry === b.entry && a.with === b.with && a.metric === b.metric && a.period === b.period;
}

/** Fold one finished tool call into the state, before the after-tool rules read it. */
export function recordToolResult(state: PolicyState, call: FinishedCall): void {
  recordConnection(state, call.tool, call.args, call.isError, call.text);

  const entry = call.entry;
  if (!entry) return;
  for (const conflict of entry.conflicts ?? []) {
    if (conflict.agree) continue;
    const note: ConflictNote = {
      entry: entry.id,
      with: conflict.with,
      metric: conflict.metric,
      period: conflict.period,
      value: conflict.value,
      otherValue: conflict.otherValue,
    };
    if (!state.conflicts.some((seen) => sameConflict(seen, note))) state.conflicts.push(note);
  }
}
