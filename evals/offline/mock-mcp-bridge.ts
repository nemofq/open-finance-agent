import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { TextContent } from "@earendil-works/pi-ai";
import type { SourceRequest } from "@/lib/data/source-snapshot";
import { isRecord } from "@/lib/utils";
import { alphaVantage } from "./mock-mcp-alphavantage";
import { type CanonicalDatabase, MOCK_MCP_FORMAT_VERSION, DatasetIntegrityError } from "./mock-mcp-data";
import { edgarFilings, edgarFinancials, edgarLookup, edgarProse, edgarRead, edgarSearchFilings } from "./mock-mcp-edgar";
import { marketQuotes } from "./mock-mcp-market";
import { CanonicalTaskView, type MockResult } from "./mock-mcp-view";
import type { OfflineAuditEvent, OfflineOutcome } from "../types";
import { webFetch, webSearch } from "./mock-mcp-web";

/**
 * The in-process MCP server a benchmark task's data tools call: production tool names and
 * parameter schemas, answered by the provider handlers from the task's view of the dataset. The
 * canonical mock is split by responsibility:
 *
 * - `mock-mcp-data.ts`: the compiled dataset's record types, integrity error and loader
 * - `mock-mcp-view.ts`: one task's time-filtered view and the lookups the handlers share
 * - `mock-mcp-web.ts`, `mock-mcp-edgar.ts`, `mock-mcp-market.ts`, `mock-mcp-alphavantage.ts`: the
 *   tool handlers, one module per provider
 * - this module: the MCP server, its tool schemas and the transport to the agent's tools
 */

function content(text: string): TextContent[] {
  return [{ type: "text", text }];
}

/** The MCP-facing contract mirrors the production tool parameters.  The
 * execution bridge still uses the production FinanceTool objects for agent
 * prompting; these schemas make direct in-process MCP calls validate the same
 * boundary instead of accepting an untyped bag of arguments. */
const TOOL_SCHEMAS: Record<string, z.ZodObject<z.ZodRawShape>> = {
  edgar_lookup_company: z.object({ query: z.string().min(1) }).passthrough(),
  edgar_filings: z.object({ ticker: z.string(), forms: z.array(z.string()).optional(), limit: z.number().int().min(1).max(50).optional() }).passthrough(),
  edgar_financials: z.object({ ticker: z.string(), statement: z.enum(["income", "balance", "cashflow", "key_metrics"]), period: z.enum(["quarterly", "annual"]), limit: z.number().int().min(1).max(20).optional() }).passthrough(),
  edgar_search_filings: z.object({ query: z.string().min(1), forms: z.array(z.string()).optional(), from: z.string().optional(), to: z.string().optional(), limit: z.number().int().min(1).max(20).optional() }).passthrough(),
  edgar_read_filing: z.object({ url: z.string(), query: z.string().optional(), maxChars: z.number().int().min(1000).max(100000).optional() }).passthrough(),
  market_quotes: z.object({ symbols: z.array(z.string()) }).passthrough(),
  web_search: z.object({ query: z.string().min(1), topic: z.enum(["general", "news"]).optional(), time_range: z.enum(["day", "week", "month", "year"]).optional(), max_results: z.number().int().min(1).max(10).optional(), include_domains: z.array(z.string()).optional() }).passthrough(),
  web_fetch: z.object({ urls: z.array(z.string()).min(1).max(5), query: z.string().optional() }).passthrough(),
  alphavantage__GLOBAL_QUOTE: z.object({ symbol: z.string() }).passthrough(),
  alphavantage__TIME_SERIES_DAILY: z.object({ symbol: z.string(), outputsize: z.string().optional(), datatype: z.string().optional() }).passthrough(),
  alphavantage__COMPANY_OVERVIEW: z.object({ symbol: z.string() }).passthrough(),
  alphavantage__EARNINGS: z.object({ symbol: z.string() }).passthrough(),
  alphavantage__NEWS_SENTIMENT: z.object({ tickers: z.string().optional(), topics: z.string().optional(), time_from: z.string().optional(), time_to: z.string().optional() }).passthrough(),
  alphavantage__SYMBOL_SEARCH: z.object({ keywords: z.string() }).passthrough(),
};

export const MOCK_TOOL_NAMES = new Set(Object.keys(TOOL_SCHEMAS));

function execute(view: CanonicalTaskView, name: string, args: Record<string, unknown>): MockResult {
  if (name === "web_search") return webSearch(view, args);
  if (name === "web_fetch") return webFetch(view, args);
  if (name === "edgar_lookup_company") return edgarProse(edgarLookup(view, args));
  if (name === "edgar_filings") return edgarProse(edgarFilings(view, args));
  if (name === "edgar_financials") return edgarProse(edgarFinancials(view, args));
  if (name === "edgar_read_filing") return edgarProse(edgarRead(view, args));
  if (name === "edgar_search_filings") return edgarProse(edgarSearchFilings(view, args));
  if (name === "market_quotes") return marketQuotes(view, args);
  if (name.startsWith("alphavantage__")) return alphaVantage(view, name.slice("alphavantage__".length), args);
  // The wording is model-visible tool output, so it keeps its old version name.
  throw new DatasetIntegrityError(view.request(name, args), "tool is not exposed by the V3 mock MCP server");
}

export class MockMcpBridge {
  private readonly view: CanonicalTaskView;
  private readonly ready: Promise<Client>;
  private readonly server: McpServer;
  private readonly auditEvents: OfflineAuditEvent[] = [];
  private readonly outcomesByCall: Record<string, OfflineOutcome> = {};

  constructor(db: CanonicalDatabase, taskId: string) {
    this.view = new CanonicalTaskView(db, taskId);
    const server = new McpServer({ name: "open-finance-agent-mock", version: MOCK_MCP_FORMAT_VERSION });
    this.server = server;
    for (const name of MOCK_TOOL_NAMES) {
      server.registerTool(name, { description: `Canonical offline implementation of ${name}`, inputSchema: TOOL_SCHEMAS[name] }, async (args) => {
        const normalizedArgs = (args ?? {}) as Record<string, unknown>;
        try {
          const result = execute(this.view, name, normalizedArgs);
          return {
            content: [{ type: "text", text: result.text }],
            structuredContent: {
              details: result.details,
              ...(result.audit ? { audit: result.audit } : {}),
              ...(result.outcome ? { outcome: result.outcome } : {}),
            },
          };
        } catch (error) {
          // Preserve typed dataset failures across the MCP transport.  The SDK
          // otherwise turns a tool exception into a plain Error, which would
          // make coverage holes indistinguishable from model/tool failures.
          if (error instanceof DatasetIntegrityError) {
            return {
              content: [{ type: "text", text: error.message }],
              isError: true,
              structuredContent: { errorType: "integrity", message: error.message, request: error.request, audit: [{ tool: name, kind: "integrity_error", normalizedRequest: normalizedArgs, reason: error.message }] },
            };
          }
          throw error;
        }
      });
    }
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    this.ready = (async () => {
      await server.connect(serverTransport);
      const client = new Client({ name: "open-finance-agent-mock-client", version: MOCK_MCP_FORMAT_VERSION });
      await client.connect(clientTransport);
      return client;
    })();
  }

  async listTools(): Promise<string[]> {
    const result = await (await this.ready).listTools();
    return result.tools.map((tool) => tool.name);
  }

  async call(name: string, args: Record<string, unknown>, toolCallId?: string): Promise<AgentToolResult<unknown>> {
    const result = await (await this.ready).callTool({ name, arguments: args });
    const blocks = Array.isArray(result.content) ? result.content as Array<{ type?: string; text?: string }> : [];
    const text = blocks.map((block) => block.type === "text" && typeof block.text === "string" ? block.text : JSON.stringify(block)).join("\n");
    const structured = isRecord(result.structuredContent) ? result.structuredContent : undefined;
    if (result.isError) {
      if (Array.isArray(structured?.audit)) this.auditEvents.push(...structured.audit as OfflineAuditEvent[]);
      if (structured?.errorType === "integrity" && isRecord(structured.request)) {
        const request = structured.request as unknown as SourceRequest;
        throw new DatasetIntegrityError(request, String(structured.message ?? text));
      }
      throw new Error(text || `${name} failed`);
    }
    if (Array.isArray(structured?.audit)) this.auditEvents.push(...structured.audit as OfflineAuditEvent[]);
    if (toolCallId && typeof structured?.outcome === "string") this.outcomesByCall[toolCallId] = structured.outcome as OfflineOutcome;
    const details = structured?.details;
    return { content: content(text), details: details ?? {} };
  }

  audit(): { events: OfflineAuditEvent[]; outcomes: Record<string, OfflineOutcome> } {
    return { events: [...this.auditEvents], outcomes: { ...this.outcomesByCall } };
  }

  async close(): Promise<void> {
    const client = await this.ready;
    await client.close();
    await this.server.close();
  }
}
