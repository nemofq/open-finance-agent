/**
 * Alpha Vantage answers a refused request with HTTP 200 and an explanation in the body, and its
 * MCP server passes that through with `isError` false. Left alone, a rate-limit notice is
 * indexed as evidence and the agent keeps calling a connection that is not answering, so these
 * bodies are turned back into failures.
 */

import { isRecord } from "@/lib/utils";
import { type JsonObject, parseJsonObject } from "./asof";

/** Alpha Vantage answers HTTP 200 with one of these keys instead of failing the request. */
const problemKeys = ["Error Message", "Information", "Note"] as const;

function problemField(body: JsonObject): string | null {
  for (const key of problemKeys) {
    const value = body[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return null;
}

/**
 * The in-band error of a body in the REST shape, which the MCP server passes through too, or null
 * when the body carries data.
 */
export function restProblem(body: string): string | null {
  if (!body.trimStart().startsWith("{")) return csvProblem(body);
  const parsed = parseJsonObject(body);
  return parsed && problemField(parsed);
}

/**
 * CSV endpoints report a problem by spreading the error key's characters across the first
 * data row (`I,n,f,o,r,m,a`), so a row of single characters means no data came back.
 */
function csvProblem(body: string): string | null {
  const [, firstRow] = body.split(/\r?\n/);
  const cells = firstRow?.split(",") ?? [];
  if (cells.length < 2 || !cells.every((cell) => cell.trim().length === 1)) return null;
  return "Alpha Vantage returned no data: the daily rate limit is reached, or this endpoint needs a premium key.";
}

/** The MCP server's envelope: `{ "error": { "type": "rate_limit", "message": "…" } }`. */
function envelopeProblem(body: JsonObject): string | null {
  const error = body.error;
  if (typeof error === "string") return error.trim() || null;
  if (!isRecord(error)) return null;

  const type = typeof error.type === "string" ? error.type.trim() : "";
  const message = typeof error.message === "string" ? error.message.trim() : "";
  if (type && message) return `${type}: ${message}`;
  return message || type || null;
}

/**
 * The failure an Alpha Vantage body reports, or null when it carries data. Covers the MCP
 * envelope and the REST-style `Error Message` / `Information` / `Note` keys.
 */
export function alphaVantageProblem(text: string): string | null {
  if (!text.trimStart().startsWith("{")) return csvProblem(text);
  const parsed = parseJsonObject(text);
  return parsed && (envelopeProblem(parsed) ?? problemField(parsed));
}

/** Throw when a body is a failure in disguise. Called inside the cache loader, so it is never stored. */
export function assertNoProblem(toolName: string, text: string): void {
  const problem = alphaVantageProblem(text);
  if (problem) throw new Error(`Alpha Vantage ${toolName} failed — ${problem}`);
}
