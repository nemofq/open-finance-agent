import type { ReportFormat } from "@/lib/reports/spec";
import { REPORT_TOOL } from "@/lib/reports/tool-name";

/**
 * One tool call as reports read it: the chat's tool parts carry these fields, so the chat hands
 * them over as they are and this feature never needs to know how a transcript is shaped.
 */
export interface ReportCall {
  id: string;
  name: string;
  args: unknown;
  /** Absent while the call runs. */
  result?: string;
  isError?: boolean;
  /** The tool's structured payload beside its text result. */
  details?: unknown;
  /** When the call settled: the tool result's time. */
  timestamp?: number;
}

/** A rich HTML report produced by the report tool, as one tool call carries it. */
export interface ReportContent {
  id: string;
  title: string;
  html: string;
  format: ReportFormat;
  /** The template the spec named, when it named one. */
  template?: string;
  /** When the call settled, in ms; the panel and the gallery show it as a relative time. */
  createdAt: number;
}

/** A report in its place in the chat: the transcript numbers them as it walks the turns. */
export interface ReportRef extends ReportContent {
  /** 1-based position among this chat's reports, for "Report 2 of 5" style labels. */
  ordinal: number;
}

function asFormat(value: unknown): ReportFormat | null {
  return value === "doc" || value === "slides" ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** The title to show while a report is still building, from either call shape. */
export function reportTitleOf(args: unknown): string {
  const call = record(args);
  if (call === null) return "Report";
  const spec = record(call.spec);
  return text(spec?.title) ?? text(call.title) ?? "Report";
}

/**
 * The report a `create_report` call produced, or `null` while it runs or if it failed. The call
 * takes a spec, and the HTML comes back on the tool result, so nothing but the stub stays in the
 * model's context.
 */
export function reportOf(part: ReportCall): ReportContent | null {
  if (part.name !== REPORT_TOOL || part.isError) return null;
  const details = record(part.details);
  const html = text(details?.html);
  if (details === null || html === null) return null;
  return {
    id: part.id,
    title: text(details.title) ?? reportTitleOf(part.args),
    html,
    format: asFormat(details.format) ?? "doc",
    ...(text(details.template) === null ? {} : { template: details.template as string }),
    createdAt: part.timestamp ?? 0,
  };
}
