import { type JsonObject, type JsonValue, validateToolArguments } from "@earendil-works/pi-ai";
import { Compile } from "typebox/compile";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { blockSchema, reportParameters, reportSpecSchema } from "./schema";

describe("create_report parameters", () => {
  // The model sees this JSON Schema, and recorded benchmark transcripts were made against it; any
  // change to shape, descriptions or required fields must show up here as a reviewed diff.
  it("keeps the wire schema the model receives", async () => {
    await expect(JSON.stringify(reportParameters, null, 2) + "\n").toMatchFileSnapshot("./__snapshots__/create-report-parameters.json");
  });
});

/**
 * One comparable shape for a Zod schema and a JSON Schema: types, fields, which are required,
 * enums, literals, length limits, defaults and descriptions. A construct either side does not
 * know throws, so a new kind of constraint cannot slip past the comparison unnoticed.
 */
interface Shape {
  kind: string;
  description?: string;
  default?: unknown;
  min?: number;
  values?: unknown[];
  fields?: Record<string, { required: boolean; shape: Shape }>;
  items?: Shape;
  options?: Shape[];
}

type ZodDef = {
  type: string;
  innerType?: z.ZodType;
  shape?: Record<string, z.ZodType>;
  element?: z.ZodType;
  options?: z.ZodType[];
  entries?: Record<string, string>;
  values?: unknown[];
  defaultValue?: unknown;
  checks?: { _zod: { def: { check: string; minimum?: number } } }[];
};

/** Length limits; `trim` (an `overwrite` check) has no JSON Schema form and is covered by the corpus. */
function zodMin(def: ZodDef): { min?: number } {
  let min: number | undefined;
  for (const check of def.checks ?? []) {
    if (check._zod.def.check === "min_length") min = check._zod.def.minimum;
    else if (check._zod.def.check !== "overwrite") throw new Error(`unmapped zod check ${check._zod.def.check}`);
  }
  return min === undefined ? {} : { min };
}

/** The input side of a Zod schema, which is what the model's arguments are checked against. */
function fromZod(schema: z.ZodType): { optional: boolean; shape: Shape } {
  const def = schema.def as unknown as ZodDef;
  const description = schema.description === undefined ? {} : { description: schema.description };
  if (def.type === "optional" || def.type === "default") {
    const inner = fromZod(def.innerType!);
    const fallback = def.type === "default" ? { default: def.defaultValue } : {};
    return { optional: true, shape: { ...inner.shape, ...fallback, ...description } };
  }
  const shape = ((): Shape => {
    switch (def.type) {
      case "string":
        return { kind: "string", ...zodMin(def) };
      case "number":
      case "boolean":
        if (def.checks?.length) throw new Error(`unmapped ${def.type} checks`);
        return { kind: def.type };
      case "enum":
        return { kind: "enum", values: Object.values(def.entries!) };
      case "literal":
        return { kind: "literal", values: def.values };
      case "array":
        return { kind: "array", ...zodMin(def), items: fromZod(def.element!).shape };
      case "union":
        return { kind: "union", options: def.options!.map((option) => fromZod(option).shape) };
      case "object":
        return { kind: "object", fields: Object.fromEntries(Object.entries(def.shape!).map(([key, field]) => {
          const { optional, shape: fieldShape } = fromZod(field);
          return [key, { required: !optional, shape: fieldShape }];
        })) };
      default:
        throw new Error(`unmapped zod type ${def.type}`);
    }
  })();
  return { optional: false, shape: { ...shape, ...description } };
}

type Json = Record<string, unknown>;
const KNOWN_KEYWORDS = new Set(["$schema", "type", "description", "default", "minLength", "minItems", "enum", "const", "properties", "required", "items", "oneOf", "anyOf"]);

function fromJson(schema: Json): Shape {
  for (const key of Object.keys(schema)) if (!KNOWN_KEYWORDS.has(key) && key !== "~standard") throw new Error(`unmapped JSON Schema keyword ${key}`);
  const extras = {
    ...(schema.description === undefined ? {} : { description: schema.description as string }),
    ...(schema.default === undefined ? {} : { default: schema.default }),
  };
  const union = (schema.oneOf ?? schema.anyOf) as Json[] | undefined;
  if (union) return { kind: "union", options: union.map(fromJson), ...extras };
  if (Array.isArray(schema.type)) return { kind: "union", options: schema.type.map((type) => ({ kind: type as string })), ...extras };
  if (schema.const !== undefined) return { kind: "literal", values: [schema.const], ...extras };
  if (schema.enum) return { kind: "enum", values: schema.enum as unknown[], ...extras };
  switch (schema.type) {
    case "string":
      return { kind: "string", ...(schema.minLength === undefined ? {} : { min: schema.minLength as number }), ...extras };
    case "number":
    case "boolean":
      return { kind: schema.type, ...extras };
    case "array":
      return { kind: "array", ...(schema.minItems === undefined ? {} : { min: schema.minItems as number }), items: fromJson(schema.items as Json), ...extras };
    case "object": {
      const required = new Set((schema.required as string[] | undefined) ?? []);
      const properties = (schema.properties ?? {}) as Record<string, Json>;
      return { kind: "object", fields: Object.fromEntries(Object.entries(properties).map(([key, field]) =>
        [key, { required: required.has(key), shape: fromJson(field) }])), ...extras };
    }
    default:
      throw new Error(`unmapped JSON Schema type ${String(schema.type)}`);
  }
}

/** A block of each type, in the order the schema lists them. */
const blocks = {
  evidence_table: { type: "evidence_table", source: "E7", metrics: ["revenue", "dilutedEps"] },
  text: { type: "text", text: "Revenue grew {C3}, led by services [E7]." },
  kpis: { type: "kpis", items: [{ label: "Revenue", cell: { ref: "E7:revenue:2024-06-30" } }] },
  table: { type: "table", columns: ["Metric", "FY24"], rows: [["Revenue", { value: 391.0, unit: "USD bn", src: "E7" }]], key: true },
  chart: { type: "chart", kind: "line", unit: "USD bn", series: [{ name: "Revenue", points: [{ x: "FY24", y: { ref: "E7:revenue:FY24" } }] }] },
  callout: { type: "callout", tone: "neutral", text: "Growth of {C1} is priced in." },
  list: { type: "list", items: ["Supply", "Pricing"] },
  html: { type: "html", html: "<p>Margin <b>up</b></p>" },
} as const;

const report = (sectionBlocks: JsonValue[], over: JsonObject = {}): JsonObject =>
  ({ title: "Quarterly comparison", sections: [{ heading: "Findings", blocks: sectionBlocks }], ...over });
const withBlock = (block: JsonObject) => report([block]);
const withCell = (cell: JsonValue) => withBlock({ type: "kpis", items: [{ label: "Revenue", cell }] });

/** Specs both definitions accept. */
const valid: [string, JsonObject][] = [
  ["every block type in one section", report(Object.values(blocks))],
  ...Object.entries(blocks).map(([type, block]): [string, JsonObject] => [`a ${type} block`, withBlock(block)]),
  ["a section with no blocks", report([])],
  ["several sections", { title: "T", sections: [{ heading: "A", blocks: [blocks.text] }, { heading: "B", blocks: [blocks.list] }] }],
  ["a named template and slides", report([blocks.text], { template: "earnings-preview", format: "slides" })],
  ["an explicit doc format", report([blocks.text], { format: "doc" })],
  ["a template the validator will flag later", report([blocks.text], { template: "custom" })],
  ["padding around title and heading", { title: "  Title  ", sections: [{ heading: " Findings ", blocks: [] }] }],
  ["an evidence table without metrics", withBlock({ type: "evidence_table", source: "C3" })],
  ["a literal cell with every field", withCell({ value: -1.25, unit: "USD/share", src: " E7 ", metric: "dilutedEps", period: "FY24", note: "diluted" })],
  ["a zero value", withCell({ value: 0, src: "C1" })],
  ["a text cell", withCell({ value: "not guided" })],
  ["an empty cell", withCell({})],
  ["a table with no rows", withBlock({ type: "table", columns: ["A"], rows: [] })],
  ["a table of text, cells and an empty row", withBlock({ type: "table", columns: ["A", "B"], rows: [["x", { value: "n/a" }], []] })],
  ["a bar chart with two series", withBlock({ type: "chart", kind: "bar", series: [
    { name: "A", points: [{ x: "Q1", y: { value: 1, src: "E1" } }] },
    { name: "B", points: [{ x: "Q1", y: { value: 2, src: "E1" } }, { x: "Q2", y: {} }] },
  ] })],
  ["a positive callout", withBlock({ type: "callout", tone: "positive", text: "Up." })],
  ["a negative callout", withBlock({ type: "callout", tone: "negative", text: "Down." })],
  ["an empty html block", withBlock({ type: "html", html: "" })],
  ["unknown keys, which the parse strips", { ...report([{ ...blocks.text, extra: 1 }]), draftId: "D1", sections: [{ heading: "A", blocks: [{ ...blocks.kpis, items: [{ label: "R", cell: { ref: "C1", why: "x" } }] }], extra: true }] }],
];

/** Specs both definitions reject. */
const invalid: [string, unknown][] = [
  ["not an object", "Quarterly comparison"],
  ["null", null],
  ["an array", [report([])]],
  ["no title", { sections: [{ heading: "A", blocks: [] }] }],
  ["an empty title", report([], { title: "" })],
  ["a numeric title", report([], { title: 7 })],
  ["no sections", { title: "T" }],
  ["no section", { title: "T", sections: [] }],
  ["sections as a string", { title: "T", sections: "[]" }],
  ["a numeric template", report([], { template: 1 })],
  ["an unknown format", report([], { format: "pdf" })],
  ["a section without a heading", { title: "T", sections: [{ blocks: [] }] }],
  ["an empty heading", { title: "T", sections: [{ heading: "", blocks: [] }] }],
  ["a section without blocks", { title: "T", sections: [{ heading: "A" }] }],
  ["a block where a section belongs", { title: "T", sections: [blocks.callout] }],
  ["blocks as an object", { title: "T", sections: [{ heading: "A", blocks: blocks.text }] }],
  ["a block without a type", withBlock({ text: "x" })],
  ["an unknown block type", withBlock({ type: "image", src: "x.png" })],
  ["a text block without text", withBlock({ type: "text" })],
  ["numeric text", withBlock({ type: "text", text: 7 })],
  ["an evidence table without a source", withBlock({ type: "evidence_table" })],
  ["an empty metrics list", withBlock({ type: "evidence_table", source: "E7", metrics: [] })],
  ["a numeric metric", withBlock({ type: "evidence_table", source: "E7", metrics: [1] })],
  ["no kpis", withBlock({ type: "kpis", items: [] })],
  ["a kpi without a label", withBlock({ type: "kpis", items: [{ cell: {} }] })],
  ["a kpi without a cell", withBlock({ type: "kpis", items: [{ label: "R" }] })],
  ["a bare number for a cell", withCell(12)],
  ["a string for a kpi cell", withCell("12")],
  ["a boolean value", withCell({ value: true })],
  ["a null value", withCell({ value: null })],
  ["a numeric ref", withCell({ ref: 7 })],
  ["a numeric src", withCell({ value: 1, src: 7 })],
  ["a table without columns", withBlock({ type: "table", columns: [], rows: [] })],
  ["a table without rows", withBlock({ type: "table", columns: ["A"] })],
  ["a row that is not a list", withBlock({ type: "table", columns: ["A"], rows: ["x"] })],
  ["a bare number in a row", withBlock({ type: "table", columns: ["A"], rows: [[1]] })],
  ["a null in a row", withBlock({ type: "table", columns: ["A"], rows: [[null]] })],
  ["a string key flag", withBlock({ type: "table", columns: ["A"], rows: [], key: "yes" })],
  ["a pie chart", withBlock({ ...blocks.chart, kind: "pie" })],
  ["a chart without a kind", withBlock({ type: "chart", series: blocks.chart.series })],
  ["a chart without series", withBlock({ type: "chart", kind: "line", series: [] })],
  ["a series without points", withBlock({ type: "chart", kind: "line", series: [{ name: "A", points: [] }] })],
  ["a series without a name", withBlock({ type: "chart", kind: "line", series: [{ points: [{ x: "Q1", y: {} }] }] })],
  ["a point without x", withBlock({ type: "chart", kind: "line", series: [{ name: "A", points: [{ y: {} }] }] })],
  ["a point with a bare y", withBlock({ type: "chart", kind: "line", series: [{ name: "A", points: [{ x: "Q1", y: 3 }] }] })],
  ["a warning callout", withBlock({ type: "callout", tone: "warning", text: "x" })],
  ["a callout without a tone", withBlock({ type: "callout", text: "x" })],
  ["an empty list", withBlock({ type: "list", items: [] })],
  ["a numeric list item", withBlock({ type: "list", items: [1] })],
  ["an html block without html", withBlock({ type: "html" })],
];

/**
 * Accepted by the projection, rejected by the Zod parse: `trim` has no JSON Schema form. Safe,
 * because `create_report` parses with Zod before the projection is checked; the other way round
 * (the projection rejecting a spec Zod accepts) would refuse a valid report and must never happen.
 */
const trimOnly: [string, unknown][] = [
  ["a whitespace-only title", report([], { title: "   " })],
  ["a whitespace-only heading", { title: "T", sections: [{ heading: " \t ", blocks: [] }] }],
];

describe("create_report parameters as a projection of the spec schema", () => {
  const projection = Compile(reportParameters);

  it("describes every block type, field, requirement and constraint the schema has", () => {
    expect(fromJson(reportParameters as unknown as Json)).toEqual(fromZod(reportSpecSchema).shape);
  });

  it("exercises every block type in the corpus", () => {
    expect(Object.keys(blocks)).toEqual(blockSchema.options.map((option) => option.shape.type.value));
  });

  it.each(valid)("both accept %s", (_name, spec) => {
    expect(reportSpecSchema.safeParse(spec).success).toBe(true);
    expect(projection.Check(spec)).toBe(true);
  });

  it.each(invalid)("both reject %s", (_name, spec) => {
    expect(reportSpecSchema.safeParse(spec).success).toBe(false);
    expect(projection.Check(spec)).toBe(false);
  });

  it.each(trimOnly)("only the Zod parse rejects %s", (_name, spec) => {
    expect(reportSpecSchema.safeParse(spec).success).toBe(false);
    expect(projection.Check(spec)).toBe(true);
  });

  // The agent loop checks prepared arguments against the projection, with its own coercion first;
  // a spec the parse accepted must come through that step untouched.
  it.each(valid)("the tool-call check passes %s through unchanged", (_name, spec) => {
    const checked = validateToolArguments({ name: "create_report", description: "", parameters: reportParameters }, { type: "toolCall", id: "call-1", name: "create_report", arguments: spec });
    expect(checked).toEqual(spec);
  });
});
