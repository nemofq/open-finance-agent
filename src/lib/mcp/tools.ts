/**
 * The shared MCP layer turns one server's tools into agent tools. The "MCP servers" module builds
 * the servers a user added on it, and a provider that is a preset for an official server (Alpha
 * Vantage) builds on it too, adding its own metadata and result handling through the options.
 */
import { Type, type TSchema } from "typebox";
import { cached } from "@/lib/cache";
import type { McpServerConfig } from "@/lib/config/schema";
import { limiterFor, type RateLimit } from "@/lib/data/rate-limit";
import { sourceRequest } from "@/lib/data/source-snapshot";
import type { StructuredDetails } from "@/lib/evidence/types";
import { stableStringify } from "@/lib/text/stable-json";
import type { FinanceTool, ToolMeta } from "@/lib/tools/contracts";
import { connect } from "./client";
import { serverClass } from "./server-class";
import type { McpInputSchema } from "./types";

/** One content block of an MCP tool result. Only text blocks go to the model verbatim. */
type ContentBlock = { type: string; text?: string; [key: string]: unknown };

export interface McpToolOptions {
  /** Further restrict the server allowlist for this module context, using raw MCP names. */
  include?: (toolName: string) => boolean;
  /** Metadata for one of the server's tools, by its raw MCP name; defaults to the server's own class/tier/coverage. */
  meta?: (toolName: string) => ToolMeta;
  /**
   * Rewrites the call arguments before the request and before the cache key, given the argument
   * names the server declares. Alpha Vantage uses it to ask for JSON rather than CSV.
   */
  prepareArgs?: (args: Record<string, unknown>, accepts: ReadonlySet<string>) => Record<string, unknown>;
  /**
   * Throws when a body that arrived as a successful result is really a failure. It runs inside
   * the cache loader, so an in-band error (Alpha Vantage answers HTTP 200 with a rate-limit
   * object) never becomes a cached value, never becomes evidence, and reaches the model as a
   * failed tool call.
   */
  checkResult?: (toolName: string, text: string) => void;
  /** Live calls this server admits per window; cache hits do not consume a slot. */
  rateLimit?: RateLimit;
  /** Rewrites a result before the model sees it (Alpha Vantage's as-of trimming) and adds structured details. */
  postProcess?: (
    toolName: string,
    args: Record<string, unknown>,
    text: string,
  ) => { text: string; details?: StructuredDetails };
}

/**
 * What a server is when it does not say otherwise: a general external tool. Only a server the
 * user marked as a data connection carries a source tier and coverage.
 */
function defaultServerMeta(server: McpServerConfig): ToolMeta {
  if (serverClass(server) !== "data") return { class: "general", effect: "external" };
  return {
    class: "data",
    effect: "read",
    // The generic connector does no point-in-time trimming; a preset that does passes its own meta.
    supportsAsOf: false,
    source: {
      id: server.id,
      name: server.name,
      tier: server.tier ?? 2,
      coverage: server.coverage ?? [],
    },
  };
}

/** Tool names reach the LLM API, which only accepts `[A-Za-z0-9_-]`. */
export function agentToolName(serverId: string, toolName: string): string {
  return `${serverId}__${toolName}`.replace(/[^A-Za-z0-9_-]/g, "_");
}

/**
 * MCP servers hand us plain JSON Schema; pi wants TypeBox. `Type.Unsafe` carries the
 * schema through untouched, which is what the model sees anyway.
 */
export function toParameters(schema: McpInputSchema | undefined): TSchema {
  if (!schema || schema.type !== "object" || !schema.properties) return Type.Object({});
  return Type.Unsafe<Record<string, unknown>>(schema);
}

/** Text blocks verbatim, anything else (images, resources) as JSON, one block per line. */
export function resultText(content: ContentBlock[] | undefined): string {
  if (!content?.length) return "";
  return content
    .map((block) => (block.type === "text" && typeof block.text === "string" ? block.text : JSON.stringify(block)))
    .join("\n");
}

/** Every tool a server exposes, filtered by its allowlist, as pi agent tools. */
export async function mcpServerTools(server: McpServerConfig, options?: McpToolOptions): Promise<FinanceTool[]> {
  const tools = await sourceRequest(
    { source: `mcp:${server.id}`, operation: "list-tools", args: {} },
    async () => {
      const client = await connect(server);
      return (await client.listTools()).tools;
    },
  );
  const allowed = tools.filter((tool) =>
    (!server.allowTools?.length || server.allowTools.includes(tool.name)) && (options?.include?.(tool.name) ?? true));

  const ttl = server.cacheTtlSeconds ?? 0;
  const limiter = options?.rateLimit ? limiterFor(server.id, options.rateLimit) : undefined;

  return allowed.map((tool): FinanceTool => {
    const declared = new Set(Object.keys((tool.inputSchema as McpInputSchema)?.properties ?? {}));

    const call = async (params: Record<string, unknown>, signal?: AbortSignal): Promise<string> => {
      // Only a live call spends quota: `call` runs on a cache miss.
      await limiter?.acquire(signal);
      // Reconnect rather than capture: a dropped connection is evicted from the pool.
      const live = await connect(server);
      const result = await live.callTool({ name: tool.name, arguments: params }, undefined, { signal });
      const text = resultText(result.content as ContentBlock[] | undefined);
      if (result.isError) throw new Error(text || `${tool.name} failed`);
      // Before returning, so a failure disguised as a result is never stored by the cache.
      options?.checkResult?.(tool.name, text);
      return text;
    };

    return {
      name: agentToolName(server.id, tool.name),
      label: tool.name,
      description: tool.description ?? tool.name,
      parameters: toParameters(tool.inputSchema as McpInputSchema),
      meta: options?.meta?.(tool.name) ?? defaultServerMeta(server),
      execute: async (_toolCallId, params, signal) => {
        const raw = (params ?? {}) as Record<string, unknown>;
        const args = options?.prepareArgs?.(raw, declared) ?? raw;
        // `cached` only stores resolved values, so failures are never cached.
        const body = await sourceRequest(
          { source: `mcp:${server.id}`, operation: tool.name, args },
          () =>
            ttl > 0
              ? cached(`mcp:${server.id}:${tool.name}:${stableStringify(args)}`, ttl, () => call(args, signal))
              : call(args, signal),
        );
        // After the cache, never inside it: the cached body is the raw server text, shared by
        // turns whose as-of dates differ.
        const processed = options?.postProcess?.(tool.name, args, body);
        return { content: [{ type: "text", text: processed?.text ?? body }], details: processed?.details ?? {} };
      },
    };
  });
}
