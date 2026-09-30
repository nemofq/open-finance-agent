import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createLedger } from "@/lib/evidence/ledger";
import type { EvidenceEntry, EvidenceLedger } from "@/lib/evidence/types";
import { evidenceModule } from "@/lib/evidence/tool";
import { capturePath, saveCapture } from "./capture";
import { createToolSeam } from "./tool-seam";
import { RETAIL_EVAL_TASKS } from "../tasks";

let home: string;
let ledger: EvidenceLedger;
// A real task, so the offline mode finds its compiled scope.
const { id: taskId, asOfDate: asOf } = RETAIL_EVAL_TASKS[0];
const fetch = vi.fn(() => { throw new Error("Local evidence must not access the network"); });
const table = { columns: ["label", "value", "note"], index: "label", rows: [
  ["first", 123, "hidden first"], ["second", 456, "hidden second"], ["third", 789, "hidden third"],
] };

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-fixture-evidence-"));
  ledger = createLedger({ sessionId: "active", dataDir: home });
  vi.stubGlobal("fetch", fetch);
  fetch.mockClear();
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  rmSync(home, { recursive: true, force: true });
});

/** An older capture holding another session's `evidence_get` result for the same id. */
function record(id: string) {
  const args = { id };
  saveCapture({ version: 2, taskId, asOf, entries: {
    [`evidence_get:${JSON.stringify(args)}`]: { tool: "evidence_get", args, recordedAt: asOf,
      result: { content: [{ type: "text", text: "Old session: unrelated recorded value 99999" }] } },
  }, resources: {} }, home);
}

async function reader(mode: "offline" | "record" = "offline") {
  const [tool] = await evidenceModule.createTools({}, { log: () => {}, session: { id: "test" }, evidence: ledger });
  const wrapper = createToolSeam({ taskId, mode, asOf, dir: home });
  return { tool: wrapper.wrapTool(tool), wrapper };
}

it.each(["offline", "record"] as const)("reads the current calculation rather than recorded ids in %s", async (mode) => {
  ledger.add({ kind: "C", summary: "Current calculation", unit: "USD", table });
  record("C1");
  const before = readFileSync(capturePath(taskId, home), "utf8");
  const { tool, wrapper } = await reader(mode);
  const result = await tool.execute("read-current", { id: "C1" });
  const text = JSON.stringify(result.content);
  expect(text).toContain("Current calculation");
  expect(text).toContain("123");
  expect(text).not.toContain("99999");
  expect(result.details).toMatchObject({ id: "C1", from: "table" });
  wrapper.flush();
  expect(readFileSync(capturePath(taskId, home), "utf8")).toBe(before);
  expect(wrapper.stats()).toMatchObject({ hits: 0, recorded: 0 });
  await wrapper.close();
});

it("applies row, column and query selection to the current table without a fixture", async () => {
  ledger.add({ kind: "E", summary: "Current source table", unit: "USD", table });
  const { tool } = await reader();
  const result = await tool.execute("slice", { id: "E1", rows: "2-3", columns: ["value"] });
  const text = JSON.stringify(result.content);
  expect(text).toContain("2 of 3 rows");
  expect(text).toContain("| second | 456 |");
  expect(text).toContain("| third | 789 |");
  expect(text).not.toContain("123");
  expect(text).not.toContain("hidden");
  const selected = await tool.execute("query", { id: "E1", query: "second" });
  expect(JSON.stringify(selected.content)).toContain("1 of 3 rows");
  expect(JSON.stringify(selected.content)).toContain("hidden second");
});

it("rejects a missing local id even if another session recorded it", async () => {
  ledger.add({ kind: "E", summary: "Known local entry", table });
  record("E999");
  const { tool } = await reader();
  await expect(tool.execute("missing", { id: "E999" })).rejects.toThrow("No evidence entry E999. This chat holds: E1.");
});

it("reads the active stored payload when an entry has no inline table", async () => {
  const entry: EvidenceEntry = ledger.add({ kind: "E", summary: "Local filing" });
  await ledger.savePayload(entry.id, { content: [{ type: "text", text: "Retained source passage from this session." }] });
  record(entry.id);
  const { tool } = await reader();
  const result = await tool.execute("payload", { id: entry.id });
  expect(result.details).toMatchObject({ id: entry.id, from: "text" });
  expect(JSON.stringify(result.content)).toContain("Retained source passage from this session.");
  expect(JSON.stringify(result.content)).not.toContain("99999");
});
