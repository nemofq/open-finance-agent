/**
 * The normalizers run over recorded tool output of the shape a replayed benchmark run feeds
 * them. The entries live in `recorded.fixture.json` beside this test, copied from the benchmark's
 * first fixtures: the benchmark's own files are re-recorded and must not move this test.
 */
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import type { ToolMeta } from "@/lib/tools/contracts";
import { normalizeResult } from "../register";

interface Cassette {
  entries: Record<string, { toolName: string; params: unknown; result: AgentToolResult<unknown> }>;
}

const edgarMeta: ToolMeta = {
  class: "data",
  effect: "read",
  source: { id: "edgar", name: "SEC EDGAR", tier: 1, coverage: ["filings"] },
};
const webMeta: ToolMeta = { class: "general", effect: "external", supportsAsOf: false };

import recorded from "./recorded.fixture.json";

function load(task: string): Cassette {
  const cassette = (recorded as unknown as Record<string, Cassette | undefined>)[task];
  expect(cassette, `${task} missing from recorded.fixture.json`).toBeDefined();
  return cassette as Cassette;
}

function entryFor(task: string, key: string, meta: ToolMeta) {
  const recorded = load(task).entries[key];
  expect(recorded, `${key} missing from ${task}`).toBeDefined();
  return normalizeResult({ name: recorded.toolName, meta }, recorded.params, recorded.result);
}

describe("recorded EDGAR output", () => {
  const entry = entryFor(
    "retail-01-nvda-beat-and-drop",
    'edgar_financials:{"limit":8,"period":"quarterly","statement":"income","ticker":"NVDA"}',
    edgarMeta,
  );

  it("keeps every figure of the press-release summary, with its line", () => {
    const values = entry.numbers?.map((number) => number.value) ?? [];
    expect(values).toContain(30_040_000_000);
    expect(values).toContain(16_599_000_000);
    expect(values).toContain(122.4);
    expect(values).toContain(0.67);
    expect(entry.numbers?.find((number) => number.value === 0.67)?.context).toContain("Diluted EPS");
    expect(entry.entity).toMatchObject({ ticker: "NVDA" });
    expect(entry.source).toEqual({ id: "edgar", name: "SEC EDGAR", tier: 1 });
  });

  it("leaves the accession number and the fiscal labels out of the figures", () => {
    const values = entry.numbers?.map((number) => number.value) ?? [];
    expect(values).not.toContain(24);
    expect(values.some((value) => String(value).includes("1045810"))).toBe(false);
  });
});

describe("recorded web output", () => {
  const entry = entryFor(
    "retail-08-macro-rate-cut-reinvestment",
    'web_search:{"query":"Federal Reserve rate cut September 2024 dot plot treasury yields"}',
    webMeta,
  );

  it("records the rates as figures and the result as open web", () => {
    const values = entry.numbers?.map((number) => number.value) ?? [];
    expect(values).toContain(50);
    expect(values).toContain(3.72);
    expect(values).toContain(21.5);
    expect(entry.source?.tier).toBe(4);
  });
});
