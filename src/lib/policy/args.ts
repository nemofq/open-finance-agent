import type { AgentTool } from "@earendil-works/pi-agent-core";
import { extractCashtags } from "@/lib/sessions/cashtags";
import { TICKER_ARGUMENTS } from "@/lib/tools/arguments";
import type { FinanceTool, ToolSource } from "@/lib/tools/contracts";
import { isRecord } from "@/lib/utils";

/** Reading tool arguments: searchable text, and the company they name. */

/** Extracts and concatenates all string values from an arguments structure. */
export function argsText(args: unknown): string {
  const parts: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string") parts.push(value);
    else if (Array.isArray(value)) for (const item of value) walk(item);
    else if (isRecord(value)) for (const item of Object.values(value)) walk(item);
  };
  walk(args);
  return parts.join(" ");
}

/** The ticker a data call is about, from a `ticker`/`symbol` argument or a cashtag in the text. */
export function tickerFromArgs(args: unknown): string | undefined {
  if (isRecord(args)) {
    for (const [key, value] of Object.entries(args)) {
      if (!TICKER_ARGUMENTS.includes(key.toLowerCase())) continue;
      if (typeof value === "string" && value.trim()) return value.trim().toUpperCase();
      const [first] = Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
      if (typeof first === "string" && first.trim()) return first.trim().toUpperCase();
    }
  }
  const [cashtag] = extractCashtags(argsText(args));
  return cashtag;
}

/** The company key a call is filed under: its ticker, or `*` for a call about no company. */
export const NO_COMPANY = "*";

export function companyKey(ticker: string | undefined): string {
  return ticker ?? NO_COMPANY;
}

export function findTool(tools: FinanceTool[], name: string): FinanceTool | undefined {
  return tools.find((tool) => tool.name === name);
}

/** A general tool that sends its arguments off the machine: web search and fetch, external MCP. */
export function isExternalGeneralTool(tool: FinanceTool | undefined): boolean {
  return tool?.meta.class === "general" && tool.meta.effect === "external";
}

/** The connection a tool belongs to, or nothing when it is not a data tool. */
export function dataSourceOf(tool: FinanceTool | undefined): ToolSource | undefined {
  return tool?.meta.class === "data" ? tool.meta.source : undefined;
}

/** Argument names that mean the same thing across tools. One table, no per-tool cases. */
const ARGUMENT_SYNONYMS: readonly (readonly string[])[] = [TICKER_ARGUMENTS];

type Properties = Record<string, { type?: unknown }>;

/**
 * Renames an argument the schema does not declare to a synonym it does, coercing between a
 * scalar and a one-item array. Arguments with no synonym are returned untouched, so validation
 * reports them exactly as before.
 */
export function mapArgumentSynonyms(args: unknown, properties: Properties): unknown {
  if (!isRecord(args)) return args;
  let out = args;
  for (const [key, value] of Object.entries(args)) {
    if (key in properties) continue;
    const target = ARGUMENT_SYNONYMS.find((group) => group.includes(key))?.find((name) => name in properties && !(name in out));
    if (!target) continue;
    const array = properties[target].type === "array";
    const coerced = array && !Array.isArray(value) ? [value] : !array && Array.isArray(value) && value.length === 1 ? value[0] : value;
    out = { ...out, [target]: coerced };
    delete out[key];
  }
  return out;
}

/** The same tool, reading its arguments through the synonym table before its own preparation. */
export function withArgumentSynonyms<T extends AgentTool>(tool: T): T {
  const properties = (tool.parameters as { properties?: Properties }).properties;
  if (!properties) return tool;
  const own = tool.prepareArguments;
  return { ...tool, prepareArguments: (args: unknown) => { const mapped = mapArgumentSynonyms(args, properties); return own ? own(mapped) : mapped; } };
}
