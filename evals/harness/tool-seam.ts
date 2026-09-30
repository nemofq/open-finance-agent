import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import {
  type SourceRequest,
  type SourceSnapshot,
  withSourceSnapshot,
  withSourceToolCall,
} from "@/lib/data/source-snapshot";
import type { FinanceTool, ToolMeta } from "@/lib/tools/contracts";
import { canonicalSourceRequest, captureKey, defaultCaptureDir, loadCapture, saveCapture, valueWithinAsOf } from "./capture";
import { loadDataset } from "../offline/dataset";
import { DatasetIntegrityError } from "../offline/mock-mcp-data";
import { ALPHA_OPERATIONS } from "../offline/mock-mcp-alphavantage";
import { MOCK_TOOL_NAMES, MockMcpBridge } from "../offline/mock-mcp-bridge";
import type { FixtureMode, OfflineAudit, OfflineAuditEvent, OfflineOutcome } from "../types";

/**
 * The seam between the agent's tools and their data, set by the run's mode. `offline` serves the
 * compiled dataset through the mock MCP; `record` fetches live and captures each provider response
 * for the dataset compiler (see `./capture`); `live` leaves the tools alone.
 */

/** How the seam answered: served offline, captured live, skipped as a local write, or failed to capture. */
export interface SeamStats {
  hits: number;
  recorded: number;
  noop: number;
  failures: number;
}

export interface ToolSeam {
  /** Whether the agent is given the tool at all: offline, an Alpha Vantage tool the dataset cannot serve is not. */
  keepTool(tool: AgentTool): boolean;
  /** A kept tool, answering from this mode's data; every tool field is kept. */
  wrapTool(tool: AgentTool): AgentTool;
  /** Scope tool construction and execution to this task's source seam. */
  run<T>(operation: () => Promise<T>): Promise<T>;
  /** Write what a `record` run captured; a no-op in every other mode. */
  flush(): void;
  stats(): SeamStats;
  offlineAudit(): OfflineAudit;
  offlineOutcomes(): Record<string, OfflineOutcome>;
  close(): Promise<void>;
}

function metaOf(tool: AgentTool): ToolMeta | undefined {
  return (tool as Partial<FinanceTool>).meta;
}

function alwaysLive(tool: AgentTool): boolean {
  return tool.name === "financial_calculator" || metaOf(tool)?.class === "finance"
    || tool.name === "evidence_get" || tool.name === "portfolio_get";
}

/**
 * The offline answer to a tool that writes local state. The wording is model-visible benchmark
 * input, so it keeps the name of the mode it was written for.
 */
function skippedWrite(tool: AgentTool): AgentToolResult<unknown> {
  return { content: [{ type: "text", text: `${tool.name}: skipped in replay mode.` }], details: { replayNoop: true } };
}

export interface ToolSeamOptions {
  taskId: string;
  mode: FixtureMode;
  asOf: string;
  /** Where `record` reads and writes the task's capture. */
  dir?: string;
}

export function createToolSeam(options: ToolSeamOptions): ToolSeam {
  const dir = options.dir ?? defaultCaptureDir();
  const { mode, taskId, asOf } = options;
  if (mode === "offline") {
    const scope = loadDataset().scopes[taskId];
    if (!scope) throw new Error(`Canonical mock MCP has no dataset for task ${taskId}.`);
    if (scope.cutoff !== asOf) throw new Error(`Dataset scope ${taskId} is pinned to ${scope.cutoff}, not task as-of ${asOf}`);
  }
  // A capture adds to what the task already has, so recording again never loses older data.
  const capture = mode === "record" ? loadCapture(taskId, dir) : undefined;
  if (capture?.asOf && capture.asOf !== asOf) {
    throw new Error(`Capture ${taskId} is pinned to ${capture.asOf}, not task as-of ${asOf}`);
  }
  const counts: SeamStats = { hits: 0, recorded: 0, noop: 0, failures: 0 };
  const mock = mode === "offline" ? new MockMcpBridge(loadDataset(), taskId) : undefined;
  let dirty = false;

  const snapshot: SourceSnapshot = {
    async resolve<T>(rawRequest: SourceRequest, load: () => Promise<T>): Promise<T> {
      if (mode === "live") return load();
      const request = canonicalSourceRequest(rawRequest);
      if (!capture) {
        const empty = offlineEmptyValue(request);
        counts.hits += 1;
        return empty as T;
      }

      let loadedValue: T;
      try {
        loadedValue = await load();
      } catch (error) {
        counts.failures += 1;
        throw error;
      }
      const value = valueWithinAsOf(request, loadedValue, asOf) as T;
      JSON.stringify(value);
      capture.resources[captureKey(request)] = { request, value, recordedAt: new Date().toISOString(), asOf };
      dirty = true;
      counts.recorded += 1;
      return value;
    },
  };

  const keepTool = (tool: AgentTool): boolean =>
    mode !== "offline" || !tool.name.startsWith("alphavantage__") || MOCK_TOOL_NAMES.has(tool.name);

  const wrapTool = (tool: AgentTool): AgentTool => {
    if (mode === "live" || alwaysLive(tool)) return tool;
    if (mock && MOCK_TOOL_NAMES.has(tool.name)) {
      return {
        ...tool,
        execute: async (toolCallId, params) => {
          // A model can still send malformed arguments to a valid mock tool. MCP returns an
          // input-validation error for that call, but it is not a coverage hole: only typed
          // dataset failures, which the mock's audit records, invalidate the run.
          counts.hits += 1;
          return mock.call(tool.name, (params ?? {}) as Record<string, unknown>, toolCallId);
        },
      };
    }
    if (mode === "offline" && metaOf(tool)?.effect === "write-local") {
      return {
        ...tool,
        execute: async () => {
          counts.noop += 1;
          return skippedWrite(tool);
        },
      };
    }
    return {
      ...tool,
      execute: (toolCallId, params, signal, onUpdate) =>
        withSourceSnapshot(snapshot, () =>
          withSourceToolCall(toolCallId, () => tool.execute(toolCallId, params, signal, onUpdate)),
        ),
    };
  };

  return {
    keepTool,
    wrapTool,
    run: (operation) => mode === "live" ? operation() : withSourceSnapshot(snapshot, operation),
    flush: () => {
      if (!capture || !dirty) return;
      saveCapture({ ...capture, asOf }, dir);
      dirty = false;
    },
    stats: () => ({ ...counts }),
    offlineAudit: () => {
      const events: OfflineAuditEvent[] = mock?.audit().events ?? [];
      return {
        emptyProviderResults: events.filter((event) => event.kind === "empty_result").length,
        corpusNotCaptured: events.filter((event) => event.kind === "not_captured").length,
        notAvailableAsOf: events.filter((event) => event.kind === "not_available_as_of").length,
        outOfScopeQueries: events.filter((event) => event.kind === "out_of_scope_query" || event.kind === "out_of_scope").length,
        integrityErrors: events.filter((event) => event.kind === "integrity_error").length,
        events,
      };
    },
    offlineOutcomes: () => ({ ...(mock?.audit().outcomes ?? {}) }),
    close: async () => {
      if (mock) await mock.close();
    },
  };
}

/**
 * What an offline provider request below the mock MCP gets: the provider's own shape for "nothing
 * found", or an integrity error for a provider or operation the dataset does not model.
 */
function offlineEmptyValue(request: SourceRequest): unknown {
  const knownSources = new Set(["edgar", "tavily", "yahoo-finance", "mcp:alphavantage"]);
  if (!knownSources.has(request.source)) throw new DatasetIntegrityError(request, "unknown provider");

  if (request.source === "tavily") {
    if (request.operation === "search") {
      return { query: String(request.args.query ?? ""), responseTime: 0, images: [], results: [], requestId: "offline-empty" };
    }
    if (request.operation === "extract") {
      const urls = Array.isArray(request.args.urls) ? request.args.urls.filter((url): url is string => typeof url === "string") : [];
      return {
        responseTime: 0,
        results: [],
        failedResults: urls.map((url) => ({ url, error: "URL is not present in the recorded task corpus" })),
        requestId: "offline-empty",
      };
    }
    throw new DatasetIntegrityError(request, "unknown Tavily operation");
  }

  if (request.source === "yahoo-finance") {
    if (request.operation === "quotes" || request.operation === "profiles") return {};
    throw new DatasetIntegrityError(request, "unknown Yahoo Finance operation");
  }

  if (request.source === "edgar") {
    if (request.operation === "tickers") return [];
    if (request.operation === "submissions" || request.operation === "companyfacts") return {};
    if (request.operation === "document") return "SEC document is not present in the compiled offline task corpus.";
    if (request.operation === "search") return { hits: { total: { value: 0 }, hits: [] } };
    throw new DatasetIntegrityError(request, "unknown EDGAR operation");
  }

  // What is left is the Alpha Vantage MCP server; its inventory is the operations the dataset models.
  if (request.operation === "list-tools") {
    return ALPHA_OPERATIONS.map((name) => ({
      name,
      description: `Canonical offline Alpha Vantage ${name}`,
      inputSchema: { type: "object", properties: {}, additionalProperties: true },
    }));
  }
  if (request.operation === "NEWS_SENTIMENT") return { feed: [], Information: "No matching news in the offline corpus." };
  if (request.operation === "EARNINGS_CALL_TRANSCRIPT") return { Information: "No earnings call transcript in the offline corpus." };
  if (request.operation === "GLOBAL_QUOTE") return { "Global Quote": {} };
  if (request.operation === "EARNINGS") return { annualEarnings: [], quarterlyEarnings: [] };
  return { Information: "No matching data in the offline corpus." };
}
