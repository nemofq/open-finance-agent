/**
 * What `afterToolCall` does with a data result: normalize it, give it an
 * evidence id, store the full payload, tag the text the model reads, and compare it with what
 * the ledger already holds.
 *
 * Computed (C), assumption (A) and report (R) entries are not created here: the calculator and
 * the report renderer add their own through `ModuleContext.evidence`.
 */
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ImageContent, JsonObject, TextContent } from "@earendil-works/pi-ai";
import type { TimeContext } from "@/lib/time/types";
import type { ToolMeta } from "@/lib/tools/contracts";
import { crossCheck } from "./crosscheck";
import { contentHash } from "./hash";
import { normalizeGeneric } from "./normalizers/generic";
import { type Normalized, structuredOf } from "./normalizers/text";
import { normalizeWeb, WEB_TOOLS } from "./normalizers/web";
import { evidenceTag } from "./tags";
import { referenceHint } from "./reference-hint";
import type { EvidenceEntry, EvidenceLedger } from "./types";

export interface RegisterInput {
  ledger: EvidenceLedger;
  tool: { name: string; meta: ToolMeta };
  toolCallId: string;
  args: JsonObject;
  result: AgentToolResult<unknown>;
  isError: boolean;
  /** Turn time context used to identify forward-dated evidence. */
  time: TimeContext;
}

export interface RegisterOutput {
  /** The entry created, when this result was evidence. */
  entry?: EvidenceEntry;
  content: (TextContent | ImageContent)[];
  details: unknown;
}

/**
 * Turns a data result into a ledger entry. Providers attach complete `StructuredDetails` when
 * their tools run, so one generic normalizer serves every source; the web tools get their own,
 * which tiers a result by its URLs. Normalizers run in `afterToolCall`, so a result replayed from
 * a benchmark cassette produces exactly the entry the live call produced.
 */
export function normalizeResult(
  tool: { name: string; meta: ToolMeta },
  args: unknown,
  result: AgentToolResult<unknown>,
): Normalized {
  const normalize = WEB_TOOLS.includes(tool.name) ? normalizeWeb : normalizeGeneric;
  const normalized = normalize(tool, args, result);
  const availableAt = structuredOf(result.details).availableAt;
  return availableAt ? { ...normalized, availableAt } : normalized;
}

/**
 * Data connections, plus the two web tools: they are general tools but return sourced text,
 * and a figure read off a web page has to be traceable like any other.
 */
export function registersEvidence(tool: { name: string; meta: ToolMeta }): boolean {
  return tool.meta.class === "data" || tool.meta.source !== undefined || WEB_TOOLS.includes(tool.name);
}

/** Put the tag and any cross-check lines above the result, keeping the original text intact. */
function withTag(
  content: (TextContent | ImageContent)[],
  header: string,
): (TextContent | ImageContent)[] {
  const index = content.findIndex((block): block is TextContent => block.type === "text");
  if (index === -1) return [{ type: "text", text: header }, ...content];
  const original = content[index] as TextContent;
  const tagged: TextContent = { ...original, text: `${header}\n\n${original.text}` };
  return content.map((block, position) => (position === index ? tagged : block));
}

function mergeDetails(details: unknown, entry: EvidenceEntry): unknown {
  if (details && typeof details === "object" && !Array.isArray(details)) {
    return { ...(details as Record<string, unknown>), evidence: entry };
  }
  return { evidence: entry };
}

/** The displayed source may use friendly labels and scaled values; Python uses the stored table. */
function tableHint({ id, table, facts }: EvidenceEntry): string | undefined {
  const index = table?.columns.indexOf(table.index ?? "") ?? -1;
  if (!table || index < 0 || table.rows.length === 0) return undefined;
  const preview = (items: unknown[]) => `${JSON.stringify(items.slice(0, 12))}${items.length > 12 ? ` (first 12 of ${items.length})` : ""}`;
  const keys = table.rows.map((row) => row[index]);
  const valueAt = (row: (string | number | null)[]) => row.findIndex((value, column) => column !== index && typeof value === "number" && Number.isFinite(value));
  const sample = new Set(keys).size === keys.length ? table.rows.find((row) => row[index] != null && valueAt(row) >= 0) : undefined;
  const column = sample ? valueAt(sample) : -1;
  const example = sample ? ` Example: \`${id}.loc[${JSON.stringify(sample[index])}, ${JSON.stringify(table.columns[column])}]\` = ${sample[column]} (stored value, before display scaling).` : "";
  const hint = `Calculator frame ${id}: index ${JSON.stringify(table.index)}; columns ${preview(table.columns.filter((_, column) => column !== index))}; row keys ${preview(keys)}.${example}`;
  const labels = new Set([...keys, ...table.columns]);
  const units = [...new Set((facts ?? []).filter((fact) => labels.has(fact.metric)).map((fact) => `${fact.metric}: ${fact.unit}`))];
  const labelled = units.length ? `${hint} Stored units: ${preview(units)}.` : hint;
  return labelled.length <= 1_500 ? labelled : hint.length <= 1_500 ? hint : undefined;
}

export async function registerToolResult(input: RegisterInput): Promise<RegisterOutput> {
  const { ledger, tool, toolCallId, args, result, isError, time } = input;
  if (isError || !registersEvidence(tool)) {
    const lookupFailed = isError && (registersEvidence(tool) || tool.meta.effect === "read");
    return { content: lookupFailed ? withTag(result.content,
      "Retrieval failed: the requested data is unavailable. This error establishes neither the requested facts nor their absence.") : result.content,
      details: result.details };
  }

  const entry = ledger.add({
    ...normalizeResult(tool, args, result),
    kind: "E",
    tool: tool.name,
    toolCallId,
    args,
    hash: contentHash(result),
  });

  // Dates compare by day: as text, a same-day timestamp sorts after its own `YYYY-MM-DD`.
  const cutoffDay = (time.asOf ?? time.localDate).slice(0, 10);
  const published = entry.availableAt;
  const futurePublication = published && (published.length > 10 && time.instant
    ? Date.parse(published) > Date.parse(time.instant)
    : published.slice(0, 10) > cutoffDay);
  if (futurePublication || (entry.asOf && entry.asOf.slice(0, 10) > cutoffDay)) {
    entry.lookAhead = true;
  }

  const { conflicts, lines } = crossCheck(entry, ledger.list("E"));
  if (conflicts.length > 0) entry.conflicts = conflicts;

  // Awaited so `hasPayload` is settled before the entry is written onto the transcript.
  await ledger.savePayload(entry.id, result);

  if (entry.lookAhead) {
    return { entry, details: mergeDetails(result.details, entry), content: [{ type: "text",
      text: `${evidenceTag(entry)}\nThe source was unavailable at this turn's cutoff (${time.instant ?? time.asOf ?? time.localDate}). Its values are withheld from analysis; the original result is retained for audit. Find a source published by the cutoff.`,
    }] };
  }

  const header = [evidenceTag(entry), ...lines].join("\n");
  const hint = [tableHint(entry), referenceHint(entry)].filter(Boolean).join("\n");
  return { entry, content: withTag(result.content, hint ? `${header}\n\n${hint}` : header), details: mergeDetails(result.details, entry) };
}
