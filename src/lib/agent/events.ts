/**
 * The wire protocol between a running turn and the browser. Types only, so client components can
 * import it without pulling in anything that runs on the server.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";
import type { ContextUsage } from "@/lib/context/types";
import type { CheckRecord } from "@/lib/policy/types";

/** Server-sent events streamed to the chat UI, mapped from pi agent events. */
export type SseEvent =
  | { type: "message_start" }
  | { type: "text_delta"; delta: string }
  | { type: "thinking_delta"; delta: string }
  /** The model has begun a tool call whose arguments are still streaming (long report HTML, for instance). */
  | { type: "tool_call_pending"; name: string }
  | { type: "tool_call_start"; id: string; name: string; args: unknown }
  | { type: "tool_call_end"; id: string; result: string; isError: boolean }
  | { type: "message_end"; message: AgentMessage }
  /**
   * The transcript as the server holds it. Sent first, and only, when a client re-attaches to a
   * turn that is already running: it replaces the older copy read from disk, and the buffered
   * events replayed after it rebuild whatever has streamed since the last `message_end`.
   */
  | { type: "snapshot"; messages: AgentMessage[] }
  | { type: "usage"; usage: Usage }
  /** An enforcement decision was recorded (also arrives as a `check` message at `message_end`). */
  | { type: "check"; check: CheckRecord }
  /** How full the model's context is, for the composer's meter. */
  | { type: "context"; usage: ContextUsage }
  /** The chat's model has written the title; the sidebar and the header follow it. */
  | { type: "title"; title: string }
  /**
   * The harness has revised the turn's final answer after it streamed (evidence placeholders
   * resolved in place, say). `text` is the full replacement text of the turn's last assistant
   * message; the saved transcript already holds it, so the chat applies it without a reload.
   */
  | { type: "answer_updated"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

