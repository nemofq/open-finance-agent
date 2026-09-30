import { jsonrepair } from "jsonrepair";
import type { Static } from "typebox";
import { coerceReportInput, reportFormatSchema, reportParameters as parameters, reportSpecSchema } from "@/lib/reports/schema";
import { reportOpening } from "@/lib/reports/opening";
import type { ReportFormat } from "@/lib/reports/spec";
import type { FinanceTool, Module, ModuleContext } from "@/lib/tools/contracts";
import { errorMessage, isRecord } from "@/lib/utils";
import { type CreateReportDetails, publishReport, reportDetails } from "./publish";
import { templateById } from "./templates";
import { REPORT_TOOL } from "./tool-name";
import { issueNotes } from "./validate";

/** The formats the spec schema accepts, for reading the module setting. */
const REPORT_FORMATS: readonly ReportFormat[] = reportFormatSchema.options;

const FALLBACK_FORMAT: ReportFormat = "doc";
const UNSAVED_INPUT = "No report was created; resend the complete title and sections.";
/** How many unverified figures the tool result names; the report itself lists them all. */
const NOTED_ISSUES = 5;

/** Compatibility at the input boundary; the advertised contract is an object only. */
function parseSpec(input: unknown): unknown {
  if (typeof input !== "string") return input;
  const json = input.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  try { return JSON.parse(json); }
  catch (error) {
    try { return JSON.parse(jsonrepair(json)); }
    catch {
      const message = errorMessage(error);
      const position = /position (\d+)/.exec(message);
      const at = position ? Number(position[1]) : json.length;
      const excerpt = JSON.stringify(json.slice(Math.max(0, at - 80), at) + "⟪HERE⟫" + json.slice(at, at + 80));
      throw new Error(`Invalid report JSON: ${message}. Syntax near the error: ${excerpt}. Correct the JSON syntax. ${UNSAVED_INPUT}`);
    }
  }
}

/**
 * The spec a call carried, as `create_report` reads it: `{ spec }` as an object or a JSON string,
 * or the spec fields inline, with `sections` sent as a string parsed too, and cells coerced.
 * Throws when the JSON cannot be repaired.
 */
export function decodeReportArgs(input: Record<string, unknown>): unknown {
  const decoded = input.spec === undefined ? input : parseSpec(input.spec);
  if (!isRecord(decoded)) return decoded;
  const record = { ...decoded };
  if (typeof record.sections === "string") record.sections = parseSpec(record.sections);
  return coerceReportInput(record);
}

const describe = (defaultFormat: ReportFormat) =>
  `Create a report from title and sections. Use it for substantive analysis; a quick fact or follow-up stays in chat.

Each section has a heading and blocks (text, kpis, table, evidence_table, chart, callout, list or html).
For a source history or calculated series, prefer {"type":"evidence_table","source":"E7","metrics":["revenue","dilutedEps"]}. It copies exact period labels, values, units and citations; omit metrics for a calculator table.
For structured facts use {"ref":"E7:revenue:2024-06-30"}; for scalar calculations use {"ref":"C3"}; for one calculated series item use {"ref":"C3:label"}, copying its exact label. Values, units and citations are filled from the ledger.
For figures quoted from filing prose, use a literal cell such as {"value":1.23,"unit":"USD/share","src":"E7"}; a prose source has no metric paths.
In prose, use {C3} or {E7:revenue:FY26 Q2}. Literal figures must be supported by their cited evidence.
Copy metric names and periods from the evidence; use calendar end dates when fiscal labels are uncertain.
Figures, Sources, Assumptions and the disclaimer are generated. Do not write those sections.
Named templates such as earnings-preview require the headings listed in the schema. Omit template for a free-form report.

Example: {"title":"Quarterly comparison","sections":[{"heading":"Findings","blocks":[{"type":"text","text":"Revenue grew {C3}, led by the service segment [E7]."}]}]}

A rejected spec was not saved; fix the named fields and resend the whole spec.
Default format for this user: ${defaultFormat}.`;

/** The configured default, ignoring anything the settings form did not constrain. */
function configuredFormat(cfg: Record<string, unknown>): ReportFormat {
  return REPORT_FORMATS.find((format) => format === cfg.format) ?? FALLBACK_FORMAT;
}

export type { CreateReportDetails };

function createReport(
  defaultFormat: ReportFormat,
  ctx: ModuleContext,
): FinanceTool<typeof parameters, CreateReportDetails> {
  return {
    name: REPORT_TOOL,
    label: "Create report",
    description: describe(defaultFormat),
    parameters,
    meta: { class: "finance", effect: "compute" },
    executionMode: "sequential",
    prepareArguments(args: unknown): Static<typeof parameters> {
      if (!args || typeof args !== "object") return args as Static<typeof parameters>;
      const settled = decodeReportArgs(args as Record<string, unknown>);
      if (!isRecord(settled)) return settled as Static<typeof parameters>;
      const checked = reportSpecSchema.safeParse(settled);
      if (!checked.success) {
        const issues = checked.error.issues.map(({ path, message }) => ({ path: path.join("."), message }));
        throw new Error(`Invalid report input. Correct these fields. ${UNSAVED_INPUT}\n${JSON.stringify(issues)}`);
      }
      return settled as Static<typeof parameters>;
    },
    async execute(toolCallId, params) {
      const ledger = ctx.evidence;
      const spec = params as { template?: string };
      const report = await publishReport(params, ledger, {
        defaultFormat,
        template: templateById(spec.template),
        toolCallId,
      });
      const { verification } = report;
      const repaired = verification.repaired;
      const summary = `verification: ${verification.supported} of ${verification.checked} figures supported, ${repaired} repaired, ${verification.unverified} unverified`;
      const notes = issueNotes(report.issues.filter((issue) => issue.kind !== "repaired"));
      const unverified = notes.length === 0 ? undefined
        : `${notes.length} figure${notes.length === 1 ? "" : "s"} could not be verified against the evidence and ${notes.length === 1 ? "is" : "are"} listed in the report under Verification notes; qualify ${notes.length === 1 ? "it" : "them"} in the conclusion:\n${notes.slice(0, NOTED_ISSUES).map((note, index) => `${index + 1}. ${note}`).join("\n")}${notes.length > NOTED_ISSUES ? `\n…and ${notes.length - NOTED_ISSUES} more.` : ""}`;

      return {
        content: [
          {
            type: "text",
            text: [`${report.stub}\nThe report is open beside the chat.\n${summary}`, unverified, reportOpening(report.spec, ledger)].filter(Boolean).join("\n\n"),
          },
        ],
        details: reportDetails(report),
      };
    },
  };
}

export const reportsModule: Module = {
  id: "reports",
  name: "Reports",
  kind: "financial-tool",
  description:
    "Structured reports the agent builds for skills and long-form analyses, checked against the evidence ledger and shown in a panel beside the chat.",
  settings: [
    {
      key: "format",
      label: "Default report format",
      type: "select",
      options: [
        { value: "doc", label: "HTML document" },
        { value: "slides", label: "HTML slides" },
      ],
      help: "Used when the model does not ask for a specific format.",
    },
  ],
  defaultConfig: { enabled: true, format: "doc" },
  async createTools(cfg, ctx) {
    return [createReport(configuredFormat(cfg), ctx)];
  },
};
