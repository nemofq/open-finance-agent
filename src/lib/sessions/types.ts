import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ModelRef } from "@/lib/config/schema";
import type { ReportSummary } from "@/lib/sessions/reports";

/**
 * A saved chat, as `sessions/<id>.json` holds it, and its metadata as the list endpoints send it.
 * The messages it holds are pi's plus this app's own, in `src/lib/agent/messages.ts`.
 */

export interface SessionFile {
  id: string;
  title: string;
  /**
   * Where the title came from: the first message ("heuristic") or the chat's model ("generated");
   * absent until the first turn names the chat.
   */
  titleSource?: "heuristic" | "generated";
  createdAt: string;
  updatedAt: string;
  /**
   * The model this chat runs on, chosen when it was created (the default, or an override) and
   * fixed for its lifetime.
   */
  model: ModelRef;
  tickers: string[];
  skill?: string;
  /** IANA time zone the browser last reported, so a resumed chat keeps the user's local date. */
  timeZone?: string;
  /** Standalone scheduled-run sessions stay out of the normal Recent list until their task is deleted. */
  visibility?: "recent" | "scheduled";
  scheduledOrigin?: { taskId: string; runId: string };
  messages: AgentMessage[];
}

/**
 * Session metadata without the transcript, for the sidebar and list endpoints. `reports` lists
 * the chat's reports (without their HTML), oldest first, so the sidebar can badge a chat that
 * produced one without loading the transcript. `running` is a turn in flight.
 */
export type SessionHeader = Omit<SessionFile, "messages"> & {
  messageCount: number;
  reports: ReportSummary[];
  running: boolean;
};
