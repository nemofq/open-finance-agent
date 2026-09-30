import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { cached } from "@/lib/cache";
import type { McpServerConfig } from "@/lib/config/schema";
import { agentToolName, mcpServerTools, resultText, toParameters } from "./tools";

const listTools = vi.fn();
const callTool = vi.fn();

vi.mock("./client", () => ({
  connect: async () => ({ listTools, callTool }),
}));

type Cache = typeof cached;

/** A cache that records its keys but always misses, so tool calls still reach the server. */
const calls: string[] = [];
const recordingCache: Cache = async (key, _ttl, fn) => {
  calls.push(key);
  return fn();
};
const cache: { current: Cache } = { current: recordingCache };

vi.mock("@/lib/cache", () => ({ cached: ((key, ttl, fn, options) => cache.current(key, ttl, fn, options)) satisfies Cache }));

const server: McpServerConfig = {
  id: "alphavantage",
  name: "Alpha Vantage",
  enabled: true,
  transport: "http",
  url: "https://example.test/mcp",
};

/** A cache that memoises like the real one, so the second call is served from the stored body. */
function memoisingCache(): Cache {
  const store = new Map<string, unknown>();
  return async <T>(key: string, _ttl: number, load: () => Promise<T>): Promise<T> => {
    if (!store.has(key)) store.set(key, await load());
    return store.get(key) as T;
  };
}

const tool = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  description: `describes ${name}`,
  inputSchema: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] },
  ...extra,
});

beforeEach(() => {
  calls.length = 0;
  cache.current = recordingCache;
  listTools.mockReset();
  callTool.mockReset();
});

describe("agentToolName", () => {
  it("namespaces a tool under its server", () => {
    expect(agentToolName("alphavantage", "GLOBAL_QUOTE")).toBe("alphavantage__GLOBAL_QUOTE");
  });

  it("replaces characters the LLM tool-name grammar rejects", () => {
    expect(agentToolName("my.server", "search files/all")).toBe("my_server__search_files_all");
  });
});

describe("toParameters", () => {
  it("passes an object schema through untouched", () => {
    const schema = { type: "object" as const, properties: { q: { type: "string" } }, required: ["q"] };
    expect(toParameters(schema)).toMatchObject(schema);
  });

  it("falls back to an empty object schema when the server declares no properties", () => {
    expect(toParameters({ type: "object" })).toEqual(expect.objectContaining({ type: "object" }));
    expect(toParameters(undefined)).toEqual(expect.objectContaining({ type: "object" }));
  });
});

describe("resultText", () => {
  it("joins text blocks with newlines", () => {
    expect(resultText([{ type: "text", text: "one" }, { type: "text", text: "two" }])).toBe("one\ntwo");
  });

  it("JSON-stringifies blocks that are not text", () => {
    expect(resultText([{ type: "image", data: "iVBOR", mimeType: "image/png" }])).toContain('"mimeType":"image/png"');
  });

  it("returns an empty string for an empty result", () => {
    expect(resultText([])).toBe("");
    expect(resultText(undefined)).toBe("");
  });
});

describe("mcpServerTools", () => {
  it("maps every advertised tool when no allowlist is set", async () => {
    listTools.mockResolvedValue({ tools: [tool("GLOBAL_QUOTE"), tool("NEWS_SENTIMENT")] });
    const tools = await mcpServerTools(server);
    expect(tools.map((t) => t.name)).toEqual(["alphavantage__GLOBAL_QUOTE", "alphavantage__NEWS_SENTIMENT"]);
    expect(tools[0].label).toBe("GLOBAL_QUOTE");
    expect(tools[0].description).toBe("describes GLOBAL_QUOTE");
  });

  it("keeps only allowlisted tools", async () => {
    listTools.mockResolvedValue({ tools: [tool("GLOBAL_QUOTE"), tool("NEWS_SENTIMENT")] });
    const tools = await mcpServerTools({ ...server, allowTools: ["NEWS_SENTIMENT"] });
    expect(tools.map((t) => t.label)).toEqual(["NEWS_SENTIMENT"]);
  });

  it("falls back to the tool name when the server gives no description", async () => {
    listTools.mockResolvedValue({ tools: [{ name: "bare", inputSchema: { type: "object" } }] });
    const [bare] = await mcpServerTools(server);
    expect(bare.description).toBe("bare");
  });

  it("lets a module restrict its allowed tools without re-enabling a denied tool", async () => {
    listTools.mockResolvedValue({ tools: [tool("snapshot"), tool("history"), tool("denied")] });
    const include = vi.fn((name: string) => name !== "snapshot");
    const tools = await mcpServerTools({ ...server, allowTools: ["snapshot", "history"] }, { include });
    expect(tools.map((entry) => entry.name)).toEqual(["alphavantage__history"]);
    expect(include.mock.calls.flat()).toEqual(["snapshot", "history"]);
    expect(callTool).not.toHaveBeenCalled();
  });

  it("returns the joined result text and calls the server with the raw arguments", async () => {
    listTools.mockResolvedValue({ tools: [tool("GLOBAL_QUOTE")] });
    callTool.mockResolvedValue({ content: [{ type: "text", text: "IBM 243.27" }] });
    const [quote] = await mcpServerTools(server);

    const result = await quote.execute("call-1", { symbol: "IBM" });
    expect(result.content).toEqual([{ type: "text", text: "IBM 243.27" }]);
    expect(result.details).toEqual({});
    expect(callTool).toHaveBeenCalledWith(
      { name: "GLOBAL_QUOTE", arguments: { symbol: "IBM" } },
      undefined,
      { signal: undefined },
    );
  });

  it("throws when the server flags the result as an error", async () => {
    listTools.mockResolvedValue({ tools: [tool("GLOBAL_QUOTE")] });
    callTool.mockResolvedValue({ isError: true, content: [{ type: "text", text: "unknown symbol" }] });
    const [quote] = await mcpServerTools(server);
    await expect(quote.execute("call-1", { symbol: "ZZZZ" })).rejects.toThrow("unknown symbol");
  });

  it("caches only when a TTL is configured", async () => {
    listTools.mockResolvedValue({ tools: [tool("GLOBAL_QUOTE")] });
    callTool.mockResolvedValue({ content: [{ type: "text", text: "ok" }] });

    const [uncached] = await mcpServerTools(server);
    await uncached.execute("call-1", { symbol: "IBM" });
    expect(calls).toEqual([]);

    const [withTtl] = await mcpServerTools({ ...server, cacheTtlSeconds: 900 });
    await withTtl.execute("call-2", { symbol: "IBM" });
    expect(calls).toEqual(['mcp:alphavantage:GLOBAL_QUOTE:{"symbol":"IBM"}']);
  });
});

describe("tool metadata", () => {
  it("treats a server with no class as a general external tool", async () => {
    listTools.mockResolvedValue({ tools: [tool("search")] });
    const [general] = await mcpServerTools(server);
    expect(general.meta).toEqual({ class: "general", effect: "external" });
  });

  it("treats a server the user marked as general the same way", async () => {
    listTools.mockResolvedValue({ tools: [tool("search")] });
    const [general] = await mcpServerTools({ ...server, class: "general" });
    expect(general.meta).toEqual({ class: "general", effect: "external" });
  });

  it("gives a data server its own source, tier and coverage", async () => {
    listTools.mockResolvedValue({ tools: [tool("GLOBAL_QUOTE")] });
    const [data] = await mcpServerTools({ ...server, class: "data", tier: 1, coverage: ["prices"] });
    expect(data.meta).toEqual({
      class: "data",
      effect: "read",
      supportsAsOf: false,
      source: { id: "alphavantage", name: "Alpha Vantage", tier: 1, coverage: ["prices"] },
    });
  });

  it("defaults a data server to tier 2 and no coverage", async () => {
    listTools.mockResolvedValue({ tools: [tool("GLOBAL_QUOTE")] });
    const [data] = await mcpServerTools({ ...server, class: "data" });
    expect(data.meta.source).toEqual({ id: "alphavantage", name: "Alpha Vantage", tier: 2, coverage: [] });
  });

  it("lets the caller declare metadata per tool", async () => {
    listTools.mockResolvedValue({ tools: [tool("GLOBAL_QUOTE"), tool("SYMBOL_SEARCH")] });
    const tools = await mcpServerTools({ ...server, class: "data" }, {
      meta: (name) => ({ class: "data", effect: "read", supportsAsOf: name === "GLOBAL_QUOTE" }),
    });
    expect(tools.map((entry) => entry.meta.supportsAsOf)).toEqual([true, false]);
  });
});

describe("postProcess", () => {
  const postProcess = (toolName: string, args: Record<string, unknown>, text: string) => ({
    text: `${text} [${toolName} ${String(args.symbol)}]`,
    details: { asOf: "2025-06-30" },
  });

  it("rewrites the text the model sees and merges its details", async () => {
    listTools.mockResolvedValue({ tools: [tool("GLOBAL_QUOTE")] });
    callTool.mockResolvedValue({ content: [{ type: "text", text: "raw" }] });
    const [quote] = await mcpServerTools(server, { postProcess });

    const result = await quote.execute("call-1", { symbol: "IBM" });
    expect(result.content).toEqual([{ type: "text", text: "raw [GLOBAL_QUOTE IBM]" }]);
    expect(result.details).toEqual({ asOf: "2025-06-30" });
  });

  it("runs after the cache, so a cached raw body is still rewritten exactly once", async () => {
    listTools.mockResolvedValue({ tools: [tool("GLOBAL_QUOTE")] });
    callTool.mockResolvedValue({ content: [{ type: "text", text: "raw" }] });
    cache.current = memoisingCache();
    const [quote] = await mcpServerTools({ ...server, cacheTtlSeconds: 900 }, { postProcess });

    const first = await quote.execute("call-1", { symbol: "IBM" });
    const second = await quote.execute("call-2", { symbol: "IBM" });
    // A second post-processing pass would show as a doubled suffix, so the cache holds the raw body.
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(first.content).toEqual([{ type: "text", text: "raw [GLOBAL_QUOTE IBM]" }]);
    expect(second.content).toEqual(first.content);
  });
});

describe("checkResult", () => {
  /** Alpha Vantage answers a refused request with HTTP 200 and an explanation in the body. */
  const refuse = (_toolName: string, text: string) => {
    if (text.includes("rate_limit")) throw new Error("Alpha Vantage GLOBAL_QUOTE failed — rate_limit");
  };

  it("turns a failure disguised as a result into a failed tool call", async () => {
    listTools.mockResolvedValue({ tools: [tool("GLOBAL_QUOTE")] });
    callTool.mockResolvedValue({ content: [{ type: "text", text: '{"error":{"type":"rate_limit"}}' }] });
    const [quote] = await mcpServerTools(server, { checkResult: refuse });

    await expect(quote.execute("call-1", { symbol: "IBM" })).rejects.toThrow("rate_limit");
  });

  it("never lets such a body into the cache", async () => {
    listTools.mockResolvedValue({ tools: [tool("GLOBAL_QUOTE")] });
    callTool.mockResolvedValue({ content: [{ type: "text", text: '{"error":{"type":"rate_limit"}}' }] });
    cache.current = memoisingCache();
    const [quote] = await mcpServerTools({ ...server, cacheTtlSeconds: 900 }, { checkResult: refuse });

    await expect(quote.execute("call-1", { symbol: "IBM" })).rejects.toThrow("rate_limit");

    // The quota recovers a minute later; a cached refusal would keep failing without asking.
    callTool.mockResolvedValue({ content: [{ type: "text", text: "IBM 243.27" }] });
    const second = await quote.execute("call-2", { symbol: "IBM" });
    expect(second.content).toEqual([{ type: "text", text: "IBM 243.27" }]);
    expect(callTool).toHaveBeenCalledTimes(2);
  });
});

describe("prepareArgs", () => {
  const preferJson = (args: Record<string, unknown>, accepts: ReadonlySet<string>) =>
    accepts.has("datatype") ? { ...args, datatype: "json" } : args;

  it("rewrites the arguments before the request and before the cache key", async () => {
    listTools.mockResolvedValue({
      tools: [
        tool("TIME_SERIES_DAILY", {
          inputSchema: { type: "object", properties: { symbol: { type: "string" }, datatype: { type: "string" } } },
        }),
      ],
    });
    callTool.mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
    const [series] = await mcpServerTools({ ...server, cacheTtlSeconds: 900 }, { prepareArgs: preferJson });

    await series.execute("call-1", { symbol: "NVDA" });
    expect(callTool).toHaveBeenCalledWith(
      { name: "TIME_SERIES_DAILY", arguments: { symbol: "NVDA", datatype: "json" } },
      undefined,
      { signal: undefined },
    );
    expect(calls).toEqual(['mcp:alphavantage:TIME_SERIES_DAILY:{"datatype":"json","symbol":"NVDA"}']);
  });

  it("leaves a tool that does not declare the argument alone", async () => {
    listTools.mockResolvedValue({ tools: [tool("GLOBAL_QUOTE")] });
    callTool.mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
    const [quote] = await mcpServerTools(server, { prepareArgs: preferJson });

    await quote.execute("call-1", { symbol: "IBM" });
    expect(callTool).toHaveBeenCalledWith({ name: "GLOBAL_QUOTE", arguments: { symbol: "IBM" } }, undefined, {
      signal: undefined,
    });
  });
});

describe("rateLimit", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds calls over the limit until the window rolls", async () => {
    vi.useFakeTimers();
    listTools.mockResolvedValue({ tools: [tool("GLOBAL_QUOTE")] });
    callTool.mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
    // A server id of its own: limiters are shared per server, so a reused id carries a used window.
    const metered = { ...server, id: "metered-two" };
    const [quote] = await mcpServerTools(metered, { rateLimit: { calls: 2, windowMs: 60_000 } });

    const running = [
      quote.execute("call-1", { symbol: "IBM" }),
      quote.execute("call-2", { symbol: "MSFT" }),
      quote.execute("call-3", { symbol: "NVDA" }),
    ];
    await vi.advanceTimersByTimeAsync(0);
    expect(callTool).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.all(running);
    expect(callTool).toHaveBeenCalledTimes(3);
  });

  it("spends no quota on a cache hit", async () => {
    vi.useFakeTimers();
    listTools.mockResolvedValue({ tools: [tool("GLOBAL_QUOTE")] });
    callTool.mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
    cache.current = memoisingCache();
    const metered = { ...server, id: "metered-one", cacheTtlSeconds: 900 };
    const [quote] = await mcpServerTools(metered, { rateLimit: { calls: 1, windowMs: 60_000 } });

    // The window allows one live call; the second is served from the cache and must not wait.
    await quote.execute("call-1", { symbol: "IBM" });
    await quote.execute("call-2", { symbol: "IBM" });
    expect(callTool).toHaveBeenCalledTimes(1);
  });
});
