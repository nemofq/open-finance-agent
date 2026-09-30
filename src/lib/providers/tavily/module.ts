import { tavily } from "@tavily/core";
import { Type } from "typebox";
import { sourceRequest } from "@/lib/data/source-snapshot";
import { settingString } from "@/lib/tools/config";
import type { FinanceTool, Module, ToolMeta } from "@/lib/tools/contracts";
import { errorMessage } from "@/lib/utils";
import { formatExtractResults, formatSearchResults } from "./format";

const maxFetchUrls = 5;

/**
 * The open web is not a data connection: it has no source tier of its own (a result takes its
 * tier from its domain) and no way to ask for the state of the web on a past date.
 */
const webMeta: ToolMeta = { class: "general", effect: "external", supportsAsOf: false };

/**
 * Search results use Tavily's published-date cutoff. An older page can still be edited later, so
 * extracted page bodies keep a date-awareness warning.
 */
function asOfCaution(asOf: string): string {
  return `\n\nNote: search results are limited to publications on or before ${asOf}; an older page may still contain later edits, so date individual claims before using them.`;
}

/** Tavily surfaces the API's own wording; the key problems are worth naming plainly. */
function friendly(err: unknown): string {
  const text = errorMessage(err);
  return /401|403|unauthorized|forbidden|invalid api key/i.test(text)
    ? "Invalid API key"
    : text;
}

/**
 * The SDK takes no AbortSignal, so a cancelled run stops waiting on the request
 * rather than cancelling it.
 */
function withAbort<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(new Error("Request aborted."));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error("Request aborted."));
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

const searchParameters = Type.Object({
  query: Type.String({ description: "Natural-language search query." }),
  topic: Type.Optional(
    Type.Union([Type.Literal("general"), Type.Literal("news")], {
      default: "general",
      description: "Use 'news' for anything time-sensitive: earnings, deals, market moves.",
    }),
  ),
  time_range: Type.Optional(
    Type.Union(
      [
        Type.Literal("day"),
        Type.Literal("week"),
        Type.Literal("month"),
        Type.Literal("year"),
      ],
      { description: "Restrict results to this window. Pair with topic 'news'." },
    ),
  ),
  max_results: Type.Optional(
    Type.Number({ minimum: 1, maximum: 10, default: 5, description: "How many results to return." }),
  ),
  include_domains: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Restrict to these domains, e.g. ['reuters.com', 'sec.gov']. Omit unless the user asked for specific sources.",
    }),
  ),
});

const fetchParameters = Type.Object({
  urls: Type.Array(Type.String(), {
    maxItems: maxFetchUrls,
    description: `Up to ${maxFetchUrls} page URLs to read, usually taken from web_search results.`,
  }),
  query: Type.Optional(
    Type.String({
      description:
        "What you are looking for on these pages. When given, only the most relevant excerpts are returned instead of the page head.",
    }),
  ),
});

interface SearchDetails {
  query: string;
  urls: string[];
}

interface FetchDetails {
  fetched: string[];
  failed: string[];
}

function createSearchTool(apiKey: string, asOf?: string): FinanceTool<typeof searchParameters, SearchDetails> {
  const client = tavily({ apiKey });
  return {
    name: "web_search",
    meta: webMeta,
    label: "Web search",
    description: `Search the web for news, analyst commentary, market colour and anything the data providers do not cover.

Prefer topic 'news' together with a time_range for recent events; a plain 'general' search skews to older, higher-ranked pages. Cite the URL of every result you rely on, and give the published date when quoting a figure. Use web_fetch to read a promising result in full instead of relying on the snippet.

Historical turns apply a publication-date cutoff. Still check dates inside older pages because their contents may have been edited later.`,
    parameters: searchParameters,
    async execute(_toolCallId, params, signal) {
      try {
        const searchOptions = {
          topic: params.topic ?? "general",
          // Tavily rejects time_range together with endDate, and a relative range would be
          // relative to today rather than the historical turn anyway.
          timeRange: asOf ? undefined : params.time_range,
          maxResults: params.max_results ?? 5,
          includeDomains: params.include_domains,
          ...(asOf ? { endDate: asOf } : {}),
          // The model sees only the snippets. The page bodies are what the benchmark's dataset
          // is compiled from, and asking for them on every search keeps the benchmark's request
          // the one users make.
          includeRawContent: "markdown" as const,
        };
        const response = await sourceRequest(
          { source: "tavily", operation: "search", args: { query: params.query, ...searchOptions } },
          () => withAbort(client.search(params.query, searchOptions), signal),
        );
        const text = formatSearchResults(params.query, response.results);
        return {
          content: [{ type: "text", text: asOf ? `${text}${asOfCaution(asOf)}` : text }],
          details: { query: params.query, urls: response.results.map((r) => r.url) },
        };
      } catch (err) {
        throw new Error(`Tavily search failed: ${friendly(err)}`);
      }
    },
  };
}

function createFetchTool(apiKey: string, asOf?: string): FinanceTool<typeof fetchParameters, FetchDetails> {
  const client = tavily({ apiKey });
  return {
    name: "web_fetch",
    meta: webMeta,
    label: "Fetch web pages",
    description: `Read the full content of up to ${maxFetchUrls} web pages as markdown.

Pass a query when you are after something specific, such as guidance language or a segment number: the tool then returns the passages that match instead of the top of the page. Long pages are truncated, so fetch the specific article rather than a section index.`,
    parameters: fetchParameters,
    async execute(_toolCallId, params, signal) {
      const urls = params.urls.slice(0, maxFetchUrls);
      if (urls.length === 0) throw new Error("web_fetch needs at least one URL.");
      try {
        // Whole pages, ranked here against the query: the same request, and the same passages,
        // whether the page comes from Tavily or from the benchmark's recording of it.
        const response = await sourceRequest(
          { source: "tavily", operation: "extract", args: { urls: [...urls].sort() } },
          () => withAbort(client.extract(urls, { extractDepth: "basic", format: "markdown" }), signal),
        );
        const text = formatExtractResults(response.results, response.failedResults, params.query);
        return {
          content: [{ type: "text", text: asOf ? `${text}${asOfCaution(asOf)}` : text }],
          details: {
            fetched: response.results.map((r) => r.url),
            failed: response.failedResults.map((r) => r.url),
          },
        };
      } catch (err) {
        throw new Error(`Tavily fetch failed: ${friendly(err)}`);
      }
    },
  };
}

export const tavilyModule: Module = {
  id: "tavily",
  name: "Tavily web search",
  kind: "tool",
  description:
    "Web search and page extraction for news, analyst commentary and anything not covered by data providers.",
  settings: [
    {
      key: "apiKey",
      label: "API key",
      type: "secret",
      required: true,
      help: "Sign up free at app.tavily.com (1,000 credits/month) and copy the key from the API Keys section",
      helpUrl: "https://app.tavily.com",
    },
  ],
  defaultConfig: { enabled: false, apiKey: "" },
  async validate(cfg) {
    const apiKey = settingString(cfg, "apiKey");
    if (!apiKey) return { ok: false, message: "Tavily API key is not set. Add it in Settings › General tools." };
    try {
      await tavily({ apiKey }).search("ping", { maxResults: 1 });
      return { ok: true, message: "Tavily key works." };
    } catch (err) {
      return { ok: false, message: friendly(err) };
    }
  },
  async createTools(cfg, ctx) {
    const apiKey = settingString(cfg, "apiKey");
    // Enabled but not configured: contribute nothing rather than a tool that always fails.
    if (!apiKey) return [];
    return [createSearchTool(apiKey, ctx.asOf), createFetchTool(apiKey, ctx.asOf)];
  },
};
