import { describe, expect, it } from "vitest";
import { deliveredReportSpecs } from "./report-content";
import type { ToolCallTrace } from "../types";

const spec = { title: "NVDA", sections: [{ heading: "Results", blocks: [{ type: "text", text: "Revenue rose 122%." }] }] };

function report(args: Record<string, unknown>, isError = false): ToolCallTrace {
  return { toolCallId: "r", toolName: "create_report", args, output: "", durationMs: 0, isError };
}

describe("delivered report specs", () => {
  it("read an object spec, a JSON string and inline fields", () => {
    expect(deliveredReportSpecs([report({ spec }), report({ spec: JSON.stringify(spec) }), report(spec)])).toEqual([spec, spec, spec]);
  });

  it("decode a fenced or slightly broken spec the way create_report does", () => {
    const fenced = `\`\`\`json\n${JSON.stringify(spec)}\n\`\`\``;
    const trailingComma = JSON.stringify(spec).replace(/}]}]}$/, "},]}]}");
    const sectionsAsText = { title: spec.title, sections: JSON.stringify(spec.sections) };
    expect(deliveredReportSpecs([report({ spec: fenced }), report({ spec: trailingComma }), report({ spec: sectionsAsText })]))
      .toEqual([spec, spec, spec]);
  });

  it("skip a rejected call and a spec production could not decode", () => {
    expect(deliveredReportSpecs([report({ spec }, true), report({ spec: "not a report" }), report({ spec: { title: "No sections" } })])).toEqual([]);
  });
});
