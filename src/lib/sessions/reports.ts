import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ReportFormat } from "@/lib/reports/spec";
import { REPORT_TOOL } from "@/lib/reports/tool-name";

/**
 * One report of a session, without its HTML: enough for a list, a gallery card or a sidebar
 * badge. `id` is the tool call id, which is also what the chat uses to open the report.
 */
export interface ReportSummary {
  id: string;
  title: string;
  format: ReportFormat;
  /** The template the spec named, when it named one. */
  template?: string;
  /** When the report was produced, as an ISO string taken from the tool result's timestamp. */
  createdAt: string;
}

function asFormat(value: unknown): ReportFormat {
  return value === "slides" ? "slides" : "doc";
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/** A hand-edited session may carry no usable timestamp; one bad file must not fail the whole list. */
function isoOf(timestamp: unknown): string {
  const ms = typeof timestamp === "number" && Number.isFinite(timestamp) ? timestamp : 0;
  return new Date(ms).toISOString();
}

/**
 * Every report a transcript holds, oldest first. A report is a successful `create_report`
 * result whose `details` carry the rendered HTML.
 */
export function reportSummariesOf(messages: AgentMessage[]): ReportSummary[] {
  const calls = new Map<string, Record<string, unknown>>();
  const reports: ReportSummary[] = [];

  for (const message of messages) {
    if (message.role === "assistant") {
      for (const content of message.content) {
        if (content.type === "toolCall" && content.name === REPORT_TOOL) calls.set(content.id, content.arguments);
      }
      continue;
    }
    if (message.role !== "toolResult" || message.isError) continue;
    const args = calls.get(message.toolCallId);
    if (args === undefined) continue;

    const details = record(message.details);
    if (details === null || text(details.html) === null) continue;
    const spec = record(args.spec);
    const template = text(details.template);
    reports.push({
      id: message.toolCallId,
      title: text(details.title) ?? text(spec?.title) ?? text(args.title) ?? "Report",
      format: asFormat(details.format),
      ...(template === null ? {} : { template }),
      createdAt: isoOf(message.timestamp),
    });
  }

  return reports;
}
