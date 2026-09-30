/**
 * Every data result but the web's: what the tool attached as `StructuredDetails` is taken as it
 * stands, and what it left out is read from the text: the numbers in it with the line each came
 * from, the subject named in the arguments and, for a result without a summary, the date it states.
 */
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ToolMeta } from "@/lib/tools/contracts";
import {
  entityFromArgs,
  extractNumbers,
  mergeEntities,
  type Normalized,
  publishedDate,
  resultText,
  sourceOf,
  structuredOf,
} from "./text";

export function normalizeGeneric(
  tool: { name: string; meta: ToolMeta },
  args: unknown,
  result: AgentToolResult<unknown>,
): Normalized {
  const text = resultText(result);
  const structured = structuredOf(result.details);
  const source = sourceOf(tool.meta, structured.source);
  const entity = mergeEntities(structured.entity, entityFromArgs(args));
  const subject = entity?.ticker ? `, $${entity.ticker}` : "";

  return {
    summary: structured.summary ?? `${source?.name ?? tool.name}${subject}`,
    source,
    entity,
    periods: structured.periods,
    unit: structured.unit,
    currency: structured.currency,
    // A result that describes itself states its own date; only an undescribed one is dated from its text.
    asOf: structured.asOf ?? (structured.summary === undefined ? publishedDate(text) : undefined),
    numbers: structured.numbers ?? (structured.facts?.length ? undefined : extractNumbers(text)),
    facts: structured.facts,
    table: structured.table,
  };
}
