import { z } from "zod";
import { Type } from "typebox";
import { reportTemplates } from "./templates";

/**
 * The report spec, defined once. These schemas validate a spec before anything touches the
 * ledger (`validateReportSpec`, `create_report`'s argument preparation), the spec types below are
 * inferred from them, and `reportParameters` projects them into the JSON Schema the model sees.
 * `src` is optional here because a cell may hold a string such as `not guided`; the source rules
 * require it for every numeric cell.
 */

/** How a create_report document is laid out by the report panel. */
export const reportFormatSchema = z.enum(["doc", "slides"]);

const cellSchema = z.object({
  ref: z.string().optional().describe("Preferred: E7:revenue:2024-06-30, C3 for a scalar, or C3:label for a calculated series item. The renderer retrieves the value, unit and source; omit value and src."),
  value: z.union([z.number(), z.string()]).default("").describe("A literal value with src, or non-numeric text such as not guided. Prefer ref for figures."),
  unit: z.string().optional(),
  src: z.string().trim().default(""),
  metric: z.string().optional().describe("Metric in the cited source; use with period to identify the exact fact."),
  period: z.string().optional(),
  note: z.string().optional(),
});

const cellOrTextSchema = z.union([cellSchema, z.string()]);

export const blockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("evidence_table"), source: z.string().describe("Evidence id such as E7 or C3. Copies the source table with exact periods, units and citations."),
    metrics: z.array(z.string()).min(1).optional().describe("For structured facts, select metric names from the evidence. Omit to show all metrics, or a calculator table.") }),
  z.object({ type: z.literal("text"), text: z.string().describe("Prose with quantitative claims as {C3} or {E7:metric:period} references.") }),
  z.object({
    type: z.literal("kpis"),
    items: z.array(z.object({ label: z.string(), cell: cellSchema })).min(1),
  }),
  z.object({
    type: z.literal("table"),
    columns: z.array(z.string()).min(1),
    rows: z.array(z.array(cellOrTextSchema)),
    key: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("chart"),
    kind: z.enum(["line", "bar"]),
    series: z
      .array(
        z.object({
          name: z.string(),
          points: z.array(z.object({ x: z.string(), y: cellSchema })).min(1),
        }),
      )
      .min(1),
    unit: z.string().optional(),
  }),
  z.object({
    type: z.literal("callout"),
    tone: z.enum(["neutral", "positive", "negative"]),
    text: z.string(),
  }),
  z.object({ type: z.literal("list"), items: z.array(z.string()).min(1) }),
  z.object({ type: z.literal("html"), html: z.string() }),
]);

const sectionSchema = z.object({ heading: z.string().trim().min(1), blocks: z.array(blockSchema) });

export const reportSpecSchema = z.object({
  title: z.string().trim().min(1).describe("Required when creating a report."),
  template: z.string().trim().optional().describe(`Optional; omit for free-form analysis. Required sections by template: ${reportTemplates.map((t) => `${t.id}: ${t.requiredSections.join(" / ")}`).join("; ")}.`),
  format: reportFormatSchema.optional(),
  sections: z
    .array(sectionSchema)
    .min(1),
});

export type ReportFormat = z.output<typeof reportFormatSchema>;
export type ReportSpec = z.output<typeof reportSpecSchema>;
export type ReportSection = z.output<typeof sectionSchema>;
export type ReportCell = z.output<typeof cellSchema>;
export type ReportBlock = z.output<typeof blockSchema>;

/**
 * The provider boundary accepts what a model is likely to send for a cell and settles it into the
 * schema's shape: a bare number or boolean becomes a string cell, a missing value an empty one, a
 * number where a cell object belongs a literal cell. Nothing here can make a report wrong; it only
 * keeps a table from failing over one cell.
 */
export function coerceReportInput(input: Record<string, unknown>): Record<string, unknown> {
  const cell = (value: unknown, literal: boolean): unknown => {
    if (value === null || value === undefined) return literal ? { value: "" } : "";
    if (typeof value === "number" || typeof value === "boolean") return literal ? { value: String(value) } : String(value);
    if (Array.isArray(value)) return literal ? { value: value.map(String).join(" ") } : value.map(String).join(" ");
    return value;
  };
  const sections = Array.isArray(input.sections) ? input.sections : [];
  return { ...input, sections: sections.map((section) => {
    if (!section || typeof section !== "object" || !Array.isArray((section as { blocks?: unknown }).blocks)) return section;
    const blocks = ((section as { blocks: unknown[] }).blocks).map((block) => {
      if (!block || typeof block !== "object") return block;
      const b = block as Record<string, unknown>;
      if (b.type === "table" && Array.isArray(b.rows)) return { ...b, rows: b.rows.map((row) => Array.isArray(row) ? row.map((c) => cell(c, false)) : row) };
      if (b.type === "kpis" && Array.isArray(b.items)) return { ...b, items: b.items.map((item) => item && typeof item === "object" ? { ...item, cell: cell((item as { cell?: unknown }).cell, true) } : item) };
      if (b.type === "chart" && Array.isArray(b.series)) return { ...b, series: b.series.map((series) => series && typeof series === "object" && Array.isArray((series as { points?: unknown }).points)
        ? { ...series, points: (series as { points: unknown[] }).points.map((point) => point && typeof point === "object" ? { ...point, y: cell((point as { y?: unknown }).y, true) } : point) } : series) };
      return b;
    });
    return { ...(section as object), blocks };
  }) };
}

/**
 * The `create_report` parameters the model sees: a projection of `reportSpecSchema` into JSON
 * Schema, never written by hand. `schema.test.ts` pins the exact wire form and checks that the
 * projection and the Zod schema accept and reject the same inputs; the one difference is `trim`,
 * which JSON Schema cannot express, so a whitespace-only title or heading passes the projection
 * and is rejected by the Zod parse that `create_report` runs first.
 */
export const reportParameters = Type.Unsafe<z.input<typeof reportSpecSchema>>(
  z.toJSONSchema(reportSpecSchema, { target: "draft-7", io: "input" }),
);
