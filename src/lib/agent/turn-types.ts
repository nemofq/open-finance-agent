import type { Agent, AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import type { SseEvent } from "@/lib/agent/events";
import type { StoredAttachment, StoredImage } from "@/lib/attachments/types";
import type { AppConfig } from "@/lib/config/schema";
import type { CompactionMessage } from "@/lib/context/types";
import type { EvidenceEntry } from "@/lib/evidence/types";
import type { CheckRecord, PolicyMode } from "@/lib/policy/types";
import type { SessionFile } from "@/lib/sessions/types";
import type { TimeContext } from "@/lib/time/types";
import type { GenerateTitleInput } from "./title";

/** Where the turn persists the transcript: the sessions folder, or a benchmark's temporary one. */
export interface TurnStore {
  update(id: string, patch: Partial<Omit<SessionFile, "id" | "createdAt">>): Promise<SessionFile | null>;
}

export interface TurnInput {
  execution?: import("./execution").ExecutionOptions;
  config: AppConfig;
  /** The chat the turn runs in, on the model it was created with. */
  session: SessionFile;
  text: string;
  skill?: string;
  /** Images already written to the session's attachments folder; they ride on the user (or skill) message. */
  images?: StoredImage[];
  /** Documents already claimed into the session's attachments folder; they ride on the same message. */
  documents?: StoredAttachment[];
  /** Metadata for a background task turn; omitted for ordinary chat messages. */
  scheduled?: { taskId: string; runId: string };
  time: TimeContext;
  store: TurnStore;
  /** Receives every wire event as it happens; the route encodes them as SSE, the benchmark collects them. */
  sink?: (event: SseEvent) => void;
  /** Developer-only tool seam (the benchmark serves its offline dataset through it), composed last as the telemetry concern. Keeps every tool field. */
  wrapTool?: (tool: AgentTool) => AgentTool;
  /** The same seam's filter: a tool it rejects is left out before the prompt, the rules or any wrapper see it. */
  keepTool?: (tool: AgentTool) => boolean;
  /**
   * Developer-only: the investor profile text the system prompt carries, in place of the block
   * rendered from the stored profile. The benchmark freezes a task's text with it, so a change to
   * how the app renders profiles never changes what that task's model reads. The stored profile
   * still drives P12 and everything else that reads it.
   */
  profileBlock?: string;
  /** Defaults to `observe` when `OFA_POLICY_OBSERVE=1` is set, else `enforce`. */
  policyMode?: PolicyMode;
  /** Called once the agent exists, so the caller can register it for abort. */
  onAgent?: (agent: Agent) => void;
  /** Opt-in retry budget for transient provider errors; production chat leaves this disabled. */
  transientProviderRetries?: number;
  /** Lets bounded callers cancel retry backoff when their deadline expires. */
  evalAbortSignal?: AbortSignal;
  /** Have the model write the chat's title on its first turn. Default true; the benchmark opts out. */
  titles?: boolean;
  /** Seam for tests: the call that writes the title. */
  generateTitle?: (input: GenerateTitleInput) => Promise<string | null>;
}

export interface TurnUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  /** Model calls made this turn. */
  calls: number;
}

export interface TurnResult {
  status: "complete" | "partial" | "failed";
  /** A completed but unvalidated draft; never substituted for a verified final answer. */
  draftText?: string;
  /** Messages appended to the transcript during this turn. */
  messages: AgentMessage[];
  /** Text of the final assistant message. */
  finalText: string;
  usage: TurnUsage;
  /** Ledger entries created during this turn. */
  evidence: EvidenceEntry[];
  checks: CheckRecord[];
  /** Follow-ups the enforcement engine sent, out of the shared `FOLLOW_UP_BUDGET`. */
  followUps: number;
  compactions: CompactionMessage[];
  durationMs: number;
  /** Transient provider attempts retried in this turn. */
  providerRetries?: number;
  /** Set after transient provider retries are exhausted. */
  infrastructureError?: boolean;
  providerRetryErrors?: string[];
  error?: string;
  /** Set when `error` is a budget or deadline stop, so callers need not read the message. */
  stop?: import("./execution").TurnStop;
  /** True when the user stopped the agent through the abort endpoint. */
  aborted?: boolean;
}
