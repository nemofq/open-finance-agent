import type { ReportVerification } from "@/lib/evidence/types";
import { reportSpecSchema } from "@/lib/reports/schema";
import type { ReportSpec } from "@/lib/reports/spec";
import { decodeReportArgs } from "@/lib/reports/tool";
import { specSurfaces } from "@/lib/reports/validate";
import { isRecord } from "@/lib/utils";
import type { ToolCallTrace } from "../types";

/**
 * What a delivered report shows a reader, read from the `create_report` arguments. The checks
 * score figures and quoted passages in the report the same way they score the chat answer, and
 * read its prose and figure cells with the validator's own walk (`specSurfaces`).
 *
 * Only a successful call delivered a report; a rejected spec showed the user nothing.
 */

/** Tool arguments and `details` arrive as `unknown`: a plain object, or undefined. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

/**
 * The spec a call carried, decoded and checked the way `create_report` does it. A spec
 * production could not decode delivered nothing.
 */
function specOf(args: Record<string, unknown>): ReportSpec | undefined {
  try {
    const parsed = reportSpecSchema.safeParse(decodeReportArgs(args));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Specs of the reports the run delivered, in call order. */
export function deliveredReportSpecs(toolCalls: ToolCallTrace[]): ReportSpec[] {
  return toolCalls.flatMap((call) => {
    if (call.toolName !== "create_report" || call.isError) return [];
    const spec = specOf(call.args);
    return spec ? [spec] : [];
  });
}

/**
 * The report validator's own per-figure outcome, which `create_report` returns in
 * `details.verification`: `checked` counts prose figures, numeric cells and references; `supported`
 * those with no issue; `repaired` citations the validator corrected (the value is held, so they are
 * backed); `unverified` the rest.
 */
export function reportVerification(details: unknown): ReportVerification | undefined {
  return asRecord(details)?.verification as ReportVerification | undefined;
}

/** The validator's summary summed over every delivered report; undefined when none was delivered. */
export function deliveredReportVerification(toolCalls: ToolCallTrace[]): Omit<ReportVerification, "byKind"> | undefined {
  const delivered = toolCalls.filter((call) => call.toolName === "create_report" && !call.isError);
  if (delivered.length === 0) return undefined;
  const total = { checked: 0, supported: 0, repaired: 0, unverified: 0 };
  for (const call of delivered) {
    const verification = reportVerification(call.details);
    if (!verification) continue;
    total.checked += verification.checked;
    total.supported += verification.supported;
    total.repaired += verification.repaired;
    total.unverified += verification.unverified;
  }
  return total;
}

/** The delivered reports' prose, one surface per line; used for quoted-passage matching. */
export function deliveredReportProse(toolCalls: ToolCallTrace[]): string {
  return deliveredReportSpecs(toolCalls).flatMap((spec) => specSurfaces(spec).map((surface) => surface.text)).join("\n");
}
