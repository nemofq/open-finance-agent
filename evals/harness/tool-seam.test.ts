import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sourceRequest } from "@/lib/data/source-snapshot";
import type { FinanceTool, ToolMeta } from "@/lib/tools/contracts";
import { CAPTURE_VERSION, canonicalSourceRequest, capturePath, captureKey, loadCapture, saveCapture } from "./capture";
import { createToolSeam } from "./tool-seam";
import { RETAIL_EVAL_TASKS } from "../tasks";

const DATA_META: ToolMeta = {
  class: "data",
  effect: "read",
  supportsAsOf: true,
  source: { id: "test-source", name: "Test source", tier: 1, coverage: ["filings"] },
};

function makeTool(
  name: string,
  resource = "company/NVDA",
  meta: ToolMeta = DATA_META,
  onLive?: () => void,
): FinanceTool {
  return {
    name,
    label: `Label for ${name}`,
    description: "A test tool",
    parameters: Type.Object({ q: Type.Optional(Type.String()) }),
    meta,
    execute: async () => {
      const text = await sourceRequest(
        { source: "test-provider", operation: "document", args: { resource } },
        async () => {
          onLive?.();
          return `live:${resource}`;
        },
      );
      return { content: [{ type: "text", text }], details: { resource } };
    },
  };
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ofa-fixtures-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("source keys", () => {
  it("normalizes order, set-like arrays, symbols and safe provider defaults", () => {
    const first = { source: "mcp:alphavantage", operation: "TIME_SERIES_DAILY", args: {
      symbol: " nvda ", outputsize: "compact", forms: ["10-Q", "10-K"],
    } };
    const second = { source: "mcp:alphavantage", operation: "TIME_SERIES_DAILY", args: {
      forms: ["10-K", "10-Q"], symbol: "NVDA",
    } };
    expect(captureKey(first)).toBe(captureKey(second));
    expect(canonicalSourceRequest(first).args).toEqual({ forms: ["10-K", "10-Q"], symbol: "NVDA" });
  });
});

describe("loading and saving", () => {
  it("writes source resources and returns an empty capture for a missing task", () => {
    const request = { source: "edgar", operation: "companyfacts", args: { url: "https://data.sec.gov/x" } };
    saveCapture({
      version: 2,
      taskId: "modern",
      asOf: "2024-08-29",
      entries: {},
      resources: {
        [captureKey(request)]: { request, value: "raw", recordedAt: "2026-01-01T00:00:00Z", asOf: "2024-08-29" },
      },
    }, dir);
    expect(loadCapture("modern", dir)).toMatchObject({ version: CAPTURE_VERSION, asOf: "2024-08-29" });
    expect(loadCapture("missing", dir)).toEqual({ version: CAPTURE_VERSION, taskId: "missing", entries: {}, resources: {} });
  });

  it("fails fast on malformed fixture members", () => {
    writeFileSync(capturePath("bad", dir), JSON.stringify({ taskId: "bad", entries: [] }));
    expect(() => loadCapture("bad", dir)).toThrow("entries is not an object");
  });
});

describe("offline", () => {
  const task = RETAIL_EVAL_TASKS[0];

  it("answers write-local tools without writing and always runs finance tools locally", async () => {
    let memoryLive = false;
    const memory = makeTool("memory_update", "memory", { class: "general", effect: "write-local" }, () => (memoryLive = true));
    let financeLive = false;
    const calculator = makeTool("financial_calculator", "calculation", { class: "finance", effect: "compute" }, () => (financeLive = true));
    const offline = createToolSeam({ taskId: task.id, mode: "offline", asOf: task.asOfDate, dir });
    const [wrappedMemory, wrappedCalculator] = [memory, calculator].map(offline.wrapTool);

    expect((await wrappedMemory.execute("memory", {})).details).toEqual({ replayNoop: true });
    await wrappedCalculator.execute("calc", {});
    expect(memoryLive).toBe(false);
    expect(financeLive).toBe(true);
    expect(offline.stats().noop).toBe(1);
    await offline.close();
  });

  it("leaves out an Alpha Vantage tool the dataset cannot serve, and only offline", async () => {
    const offline = createToolSeam({ taskId: task.id, mode: "offline", asOf: task.asOfDate, dir });
    const served = makeTool("alphavantage__GLOBAL_QUOTE");
    const unserved = makeTool("alphavantage__NOT_IN_THE_DATASET");
    expect([served, unserved, makeTool("web_search")].map((tool) => offline.keepTool(tool))).toEqual([true, false, true]);
    await offline.close();
    const recorder = createToolSeam({ taskId: "t", mode: "record", asOf: "2024-08-29", dir });
    expect(recorder.keepTool(unserved)).toBe(true);
  });

  it("gives a provider request below the mock its empty shape without going live", async () => {
    const offline = createToolSeam({ taskId: task.id, mode: "offline", asOf: task.asOfDate, dir });
    const quotes = await offline.run(() => sourceRequest(
      { source: "yahoo-finance", operation: "quotes", args: { symbols: ["NVDA"] } },
      async () => { throw new Error("must not go live"); },
    ));
    expect(quotes).toEqual({});
    await expect(offline.run(() => sourceRequest(
      { source: "test-provider", operation: "document", args: {} },
      async () => { throw new Error("must not go live"); },
    ))).rejects.toThrow("unknown provider");
    await offline.close();
  });

  it("refuses a task whose compiled cutoff differs from its definition", () => {
    expect(() => createToolSeam({ taskId: task.id, mode: "offline", asOf: "2024-01-01", dir })).toThrow("pinned");
  });
});

describe("record", () => {
  it("creates a missing capture and records every request live", async () => {
    let live = 0;
    const wrapper = createToolSeam({ taskId: "t", mode: "record", asOf: "2024-08-29", dir });
    const tool = wrapper.wrapTool(makeTool("dummy", "same", DATA_META, () => live++));
    await tool.execute("first", {});
    await tool.execute("second", {});
    wrapper.flush();

    const loaded = loadCapture("t", dir);
    expect(loaded).toMatchObject({ version: CAPTURE_VERSION, taskId: "t", asOf: "2024-08-29" });
    expect(Object.keys(loaded.resources)).toHaveLength(1);
    expect(live).toBe(2);
    expect(wrapper.stats()).toMatchObject({ recorded: 2 });
  });

  it("adds to an existing capture, keeps its tool entries, and refuses an as-of mismatch", async () => {
    const old = { source: "test-provider", operation: "document", args: { resource: "old" } };
    saveCapture({
      version: CAPTURE_VERSION,
      taskId: "t",
      asOf: "2024-08-29",
      entries: { "edgar_filings:{}": { tool: "edgar_filings", args: {} } },
      resources: { [captureKey(old)]: { request: old, value: "old", recordedAt: "2026-01-01T00:00:00Z", asOf: "2024-08-29" } },
    }, dir);

    const wrapper = createToolSeam({ taskId: "t", mode: "record", asOf: "2024-08-29", dir });
    await wrapper.wrapTool(makeTool("new", "new")).execute("new", {});
    wrapper.flush();

    const loaded = loadCapture("t", dir);
    expect(Object.values(loaded.resources).map((entry) => entry.request.args)).toEqual([{ resource: "old" }, { resource: "new" }]);
    expect(Object.keys(loaded.entries)).toEqual(["edgar_filings:{}"]);
    expect(() => createToolSeam({ taskId: "t", mode: "record", asOf: "2024-08-30", dir })).toThrow("pinned");
  });

  it("drops search results published after the task cutoff before use or recording", async () => {
    const request = {
      source: "tavily",
      operation: "search",
      args: { query: "dated results", endDate: "2024-08-29" },
    };
    const wrapper = createToolSeam({ taskId: "dated-web", mode: "record", asOf: "2024-08-29", dir });
    const result = await wrapper.run(() => sourceRequest(request, async () => ({
      results: [
        { url: "https://example.com/old", publishedDate: "2024-08-28" },
        { url: "https://example.com/future", publishedDate: "2024-08-30" },
      ],
    }))) as { results: { url: string }[] };
    wrapper.flush();

    expect(result.results.map((entry) => entry.url)).toEqual(["https://example.com/old"]);
    const stored = Object.values(loadCapture("dated-web", dir).resources)[0].value as { results: { url: string }[] };
    expect(stored.results.map((entry) => entry.url)).toEqual(["https://example.com/old"]);
  });
});

describe("the wrapper", () => {
  it("keeps tool metadata and returns tools untouched in live mode", () => {
    const tool = makeTool("dummy");
    const recorder = createToolSeam({ taskId: "t", mode: "record", asOf: "2024-08-29", dir });
    const wrapped = recorder.wrapTool(tool) as FinanceTool;
    expect(wrapped.meta).toEqual(DATA_META);
    expect(wrapped.parameters).toBe(tool.parameters);
    expect(wrapped.execute).not.toBe(tool.execute);

    const live = createToolSeam({ taskId: "t", mode: "live", asOf: "2024-08-29", dir });
    expect(live.wrapTool(tool as AgentTool)).toBe(tool);
  });
});
