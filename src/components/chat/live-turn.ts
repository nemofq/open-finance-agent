import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SseEvent } from "@/lib/agent/events";
import type { ContextUsage } from "@/lib/context/types";
import type { CheckRecord } from "@/lib/policy/types";
import { REPORT_TOOL } from "@/lib/reports/tool-name";
import { carryAttachments } from "./message-attachments";
import { appendChecks, appendDelta, endThinking, type MessagePart, reviseAnswer, type ToolOutcome } from "./transcript";
import { WORKING, type WorkPhase } from "./working-indicator";

type Update<T> = (update: (current: T) => T) => void;

/** Where a turn's events land: the chat's own state setters, and what a turn tells the rest of the page. */
export interface TurnSink {
  setMessages: Update<AgentMessage[]>;
  setLive: Update<MessagePart[]>;
  setToolOutcomes: Update<Record<string, ToolOutcome>>;
  setPhase: (phase: WorkPhase) => void;
  setContext: (usage: ContextUsage) => void;
  setError: (message: string) => void;
  /** The model has named the chat mid-turn. */
  setTitle: (title: string) => void;
  /** A report finished; it is what the turn was for, so it comes up straight away. */
  openReport: (id: string) => void;
}

export interface LiveTurn {
  /** Apply one wire event. Shared by a fresh send and a re-attach to a live run. */
  apply: (event: SseEvent) => void;
  /** A new message is going out: nothing of the last turn's is held back any more. */
  begin: () => void;
  /** Close the turn out: the checks held back until the end go on the transcript. */
  finish: () => void;
}

/**
 * Let go of a sent message's preview object URLs once its turn has settled. A turn the server
 * accepted (its messages request returned a stream) is saved with the stored files, so the
 * previews are dead weight even when a Stop dropped the echo before it reached the screen. A
 * refused send keeps them: Retry sends the same message, and the bubble on screen has nothing else
 * to draw from.
 */
export function releasePreviews(images: readonly { previewUrl: string }[], accepted: boolean): void {
  if (!accepted) return;
  for (const image of images) URL.revokeObjectURL(image.previewUrl);
}

/**
 * What one chat keeps between the events of a turn: which tool each call id is, the checks that
 * wait for the end, and when the live message started reasoning. Every state change goes through
 * `sink`, in the order the events arrive.
 */
export function createLiveTurn(sink: TurnSink, now: () => number = Date.now): LiveTurn {
  /** Tool name by call id, so `tool_call_end` can tell a report from any other tool. */
  const runningTools = new Map<string, string>();
  /** This turn's enforcement decisions; they go on the transcript once the stream closes. */
  let turnChecks: CheckRecord[] = [];
  /** When the live message started reasoning, so its thinking block can be timed as it happens. */
  let thinkingStart: number | null = null;

  /**
   * Reasoning has given way to something else. The server stamps the same duration at
   * `message_end`; this is so the label settles the moment the model stops thinking.
   */
  const endThinkingSpan = () => {
    const started = thinkingStart;
    if (started === null) return;
    thinkingStart = null;
    const elapsed = now() - started;
    sink.setLive((parts) => endThinking(parts, elapsed));
  };

  const apply = (event: SseEvent) => {
    switch (event.type) {
      case "snapshot":
        // Only a re-attach sees this: the server's transcript is newer than the copy read from
        // disk, and the events replayed behind it rebuild everything streamed since.
        sink.setMessages(() => event.messages);
        sink.setLive(() => []);
        sink.setToolOutcomes(() => ({}));
        runningTools.clear();
        turnChecks = [];
        thinkingStart = null;
        break;
      case "message_start":
        sink.setLive(() => []);
        thinkingStart = null;
        sink.setPhase(WORKING);
        break;
      case "text_delta":
        endThinkingSpan();
        sink.setLive((parts) => appendDelta(parts, "text", event.delta));
        sink.setPhase({ kind: "writing" });
        break;
      case "thinking_delta":
        thinkingStart ??= now();
        sink.setLive((parts) => appendDelta(parts, "thinking", event.delta));
        sink.setPhase({ kind: "thinking" });
        break;
      case "tool_call_pending":
        endThinkingSpan();
        // The name arrives with the first chunk of arguments; until then the phase stands.
        if (event.name === REPORT_TOOL) sink.setPhase({ kind: "drafting" });
        else if (event.name) sink.setPhase({ kind: "calling", tool: event.name });
        break;
      case "tool_call_start":
        endThinkingSpan();
        runningTools.set(event.id, event.name);
        sink.setPhase({ kind: "running", tool: event.name });
        break;
      case "tool_call_end": {
        sink.setToolOutcomes((prev) => ({ ...prev, [event.id]: { result: event.result, isError: event.isError } }));
        const name = runningTools.get(event.id);
        runningTools.delete(event.id);
        if (name === REPORT_TOOL && !event.isError) sink.openReport(event.id);
        sink.setPhase(WORKING);
        break;
      }
      case "check":
        // An enforced follow-up sends the answer back to be revised, so it goes on the
        // transcript at once, right after the answer it judged: that answer collapses into
        // its draft block while the revision streams below. The rest wait for the run's end.
        if (event.check.kind === "follow_up" && event.check.enforced) {
          sink.setMessages((prev) => appendChecks(prev, [event.check]));
          sink.setPhase({ kind: "revising" });
        } else {
          turnChecks.push(event.check);
        }
        break;
      case "context":
        sink.setContext(event.usage);
        break;
      case "message_end": {
        endThinkingSpan();
        // A checkpoint is written between model turns rather than streamed, so it only
        // joins the transcript; nothing on screen has finished.
        if (event.message.role === "compaction") {
          const compaction = event.message;
          sink.setMessages((prev) => [...prev, compaction]);
          break;
        }
        // A queued follow-up is replayed as a message of its own; the `check` event above
        // has already put it on the transcript, so this pass only fills in what is missing.
        if (event.message.role === "check") {
          const { check } = event.message;
          sink.setMessages((prev) => appendChecks(prev, [check]));
          break;
        }
        // The user's own turn is already on screen optimistically; swap in the server's
        // copy of it, and append everything the agent produces after it.
        const echo = event.message.role === "user" || event.message.role === "skill";
        // The saved turn takes the optimistic one's object URLs with it, so a thumbnail keeps
        // showing the local copy until the stored file has been fetched.
        const message = event.message;
        sink.setMessages((prev) =>
          echo ? [...prev.slice(0, -1), carryAttachments(prev.at(-1), message)] : [...prev, message],
        );
        sink.setLive(() => []);
        sink.setPhase(WORKING);
        break;
      }
      case "title":
        sink.setTitle(event.title);
        break;
      case "answer_updated":
        // The harness revised the answer after it streamed; the saved copy already has it.
        sink.setMessages((prev) => reviseAnswer(prev, event.text));
        break;
      case "error":
        sink.setError(event.message);
        break;
      default:
        break;
    }
  };

  return {
    apply,
    begin: () => {
      turnChecks = [];
    },
    finish: () => {
      // The server saves the same checks after the answer, but only once its stream is closed.
      // React may run the updater later, so it takes the list as it stands now, not the field.
      const held = turnChecks;
      sink.setMessages((prev) => appendChecks(prev, held));
      turnChecks = [];
      runningTools.clear();
    },
  };
}
