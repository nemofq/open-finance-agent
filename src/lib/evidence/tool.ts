import { Type } from "typebox";
import { markdownCell } from "@/lib/attachments/digest";
import { reportReference } from "@/lib/evidence/ids";
import { referenceHint } from "@/lib/evidence/reference-hint";
import type { EvidenceEntry, EvidenceLedger, EvidenceTable } from "@/lib/evidence/types";
import { bestChunks } from "@/lib/text/chunks";
import type { FinanceTool, Module, ModuleContext } from "@/lib/tools/contracts";
import { evidenceTag } from "./tags";

/** A slice the model can read without the table flooding its context. */
const DEFAULT_ROWS = 50;
const MAX_ROWS = 200;
const MAX_FACTS = 120;
const MAX_TEXT_CHARS = 8_000;
/** Passages a text query returns: about as much text as an unqueried read. */
const MAX_PASSAGES = 5;

const parameters = Type.Object({
  id: Type.String({ description: "Evidence id from a result tag, e.g. `E7` or `C3`." }),
  rows: Type.Optional(
    Type.String({
      description:
        "Which rows of a table entry to return: a range like `1-20`, a list like `1,5,9`, or both. Defaults to the first 50.",
    }),
  ),
  columns: Type.Optional(
    Type.Array(Type.String(), {
      description: "Column names to keep, e.g. ['date','close']. Omit for every column.",
    }),
  ),
  query: Type.Optional(
    Type.String({
      description:
        "What you are looking for. On a table it keeps the matching rows; on a filing or web page it returns the matching passages.",
    }),
  ),
});

/** What an `evidence_get` result carries on its `details`. */
export interface EvidenceGetDetails {
  id: string;
  kind: string;
  /** What the slice was taken from: the entry's table, its facts, or the stored payload text. */
  from: EvidenceRead["from"];
}

/** What the budget needs of an `evidence_get` result. */
export interface EvidenceRead {
  id: string;
  from: "table" | "facts" | "text" | "summary";
}

const READ_FROM: readonly unknown[] = ["table", "facts", "text", "summary"] satisfies EvidenceRead["from"][];

/** Whether a tool result's `details` are an `evidence_get` read of entry `id`. */
export function isEvidenceRead(details: unknown): details is EvidenceRead {
  if (!details || typeof details !== "object") return false;
  const { id, from } = details as Record<string, unknown>;
  return typeof id === "string" && id !== "" && READ_FROM.includes(from);
}

function markdownTable(columns: string[], rows: (string | number | null)[][]): string {
  const cell = (value: string | number | null): string => (value === null ? "—" : markdownCell(value));
  return [
    `| ${columns.map(markdownCell).join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ].join("\n");
}

/** `1-20`, `3`, `1,5,9` or any mix, as zero-based row indexes inside `total`. */
export function parseRowSpec(spec: string | undefined, total: number): number[] {
  if (!spec?.trim()) return [...Array(Math.min(total, DEFAULT_ROWS)).keys()];
  const wanted = new Set<number>();
  for (const part of spec.split(",")) {
    const range = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(part);
    if (range) {
      for (let row = Number(range[1]); row <= Number(range[2]); row += 1) wanted.add(row - 1);
      continue;
    }
    const single = Number(part.trim());
    if (Number.isInteger(single) && single > 0) wanted.add(single - 1);
  }
  return [...wanted].filter((index) => index >= 0 && index < total).sort((a, b) => a - b).slice(0, MAX_ROWS);
}

function matchesQuery(row: (string | number | null)[], terms: string[]): boolean {
  const haystack = row.map((cell) => String(cell ?? "")).join(" ").toLowerCase();
  return terms.some((term) => haystack.includes(term));
}

function sliceTable(table: EvidenceTable, params: { rows?: string; columns?: string[]; query?: string }, seriesId?: string): string {
  const keep = params.columns?.length
    ? table.columns.filter(
        (column) =>
          column === table.index ||
          params.columns?.some((wanted) => wanted.toLowerCase() === column.toLowerCase()),
      )
    : table.columns;
  const columns = keep.length ? keep : table.columns;
  const indexes = columns.map((column) => table.columns.indexOf(column));

  const terms = params.query?.toLowerCase().split(/\s+/).filter((term) => term.length > 1) ?? [];
  const candidates = terms.length ? table.rows.filter((row) => matchesQuery(row, terms)) : table.rows;
  const chosen = terms.length
    ? candidates.slice(0, MAX_ROWS)
    : parseRowSpec(params.rows, candidates.length).map((index) => candidates[index]);

  const body = markdownTable(columns, chosen.map((row) => indexes.map((index) => row[index] ?? null)));
  const key = table.columns.indexOf(table.index ?? "");
  const unique = key >= 0 && new Set(table.rows.map((row) => String(row[key]))).size === table.rows.length;
  const refs = seriesId && unique ? chosen.slice(0, 12).map((row) => reportReference(seriesId, String(row[key]))).filter(Boolean) : [];
  return `${chosen.length} of ${table.rows.length} rows\n\n${body}${refs.length ? `\n\nReport references: ${refs.join(", ")}. For the whole series use evidence_table with source "${seriesId}".` : ""}`;
}

function listFacts(entry: EvidenceEntry, query?: string): string {
  const terms = query?.toLowerCase().split(/\s+/).filter((term) => term.length > 1) ?? [];
  const facts = (entry.facts ?? []).filter(
    (fact) => terms.length === 0 || terms.some((term) => `${fact.metric} ${fact.period}`.toLowerCase().includes(term)),
  );
  const lines = facts
    .slice(0, MAX_FACTS)
    .map((fact) => `- ${fact.metric} ${fact.period}: ${fact.value} ${fact.unit}${fact.ref ? ` (${fact.ref})` : ""}${reportReference(entry.id, fact.metric, fact.period) ? ` · report ${reportReference(entry.id, fact.metric, fact.period)}` : ""}`);
  return [`${facts.length} fact${facts.length === 1 ? "" : "s"}`, "", ...lines].join("\n");
}

/** The text of a stored tool result, which is what a filing or a web page payload is. */
function payloadText(payload: unknown): string {
  const content = (payload as { content?: { type: string; text?: string }[] } | undefined)?.content;
  if (!Array.isArray(content)) return typeof payload === "string" ? payload : "";
  return content
    .map((block) => (block.type === "text" && typeof block.text === "string" ? block.text : ""))
    .filter(Boolean)
    .join("\n");
}

async function render(
  ledger: EvidenceLedger,
  entry: EvidenceEntry,
  params: { rows?: string; columns?: string[]; query?: string },
): Promise<{ text: string; from: EvidenceRead["from"] }> {
  if (entry.table) return { text: sliceTable(entry.table, params, entry.kind === "C" ? entry.id : undefined), from: "table" };
  if (entry.facts?.length) return { text: listFacts(entry, params.query), from: "facts" };

  const text = payloadText(await ledger.loadPayload(entry.id));
  if (text) {
    const body = params.query ? bestChunks(text, params.query, MAX_PASSAGES) : text.slice(0, MAX_TEXT_CHARS);
    return { text: body, from: "text" };
  }

  const numbers = (entry.numbers ?? []).slice(0, MAX_FACTS).map((number) => `- ${number.value}${number.unit ? ` ${number.unit}` : ""} — ${number.context}`);
  if (numbers.length) return { text: numbers.join("\n"), from: "summary" };
  return { text: entry.summary, from: "summary" };
}

function evidenceGetTool(ctx: ModuleContext): FinanceTool<typeof parameters, EvidenceGetDetails> {
  return {
    name: "evidence_get",
    meta: { class: "general", effect: "read" },
    label: "Read stored evidence",
    description: `Return the exact stored values behind an evidence id, straight from disk.

Use it when a figure you need is no longer in front of you: an older tool result has been shortened to a one-line stub, the chat was compacted, or you only kept part of a table. Never retype a number from memory — fetch it.

Give the id from a result tag (\`[E7 · SEC EDGAR · tier 1 · …]\`). For a table entry, \`rows\` and \`columns\` cut it down (\`rows: "1-8"\`, \`columns: ["date","close"]\`); for a filing or a web page, \`query\` returns the passages that match. When an earlier result has been summarised away, fetch its id rather than recalling the number.`,
    parameters,
    async execute(_toolCallId, params) {
      const ledger = ctx.evidence;
      const id = params.id.trim().toUpperCase();
      const entry = ledger.get(id);
      if (!entry) {
        const known = ledger.list().map((item) => item.id);
        throw new Error(
          known.length
            ? `No evidence entry ${id}. This chat holds: ${known.join(", ")}.`
            : `No evidence entry ${id}; this chat has no evidence yet.`,
        );
      }

      if (entry.lookAhead) throw new Error(`${id} was unavailable at this turn's cutoff; its values cannot be used in this analysis.`);
      const { text, from } = await render(ledger, entry, params);
      return {
        content: [{ type: "text", text: [`${evidenceTag(entry)} ${entry.summary}`, from === "summary" ? referenceHint(entry) : undefined, text].filter(Boolean).join("\n\n") }],
        details: { id: entry.id, kind: entry.kind, from },
      };
    },
  };
}

/**
 * `evidence_get` keeps exact figures reachable after a result has been stubbed or the context
 * compacted. It owns no data of its own: the ledger on `ModuleContext` does.
 */
export const evidenceModule: Module = {
  id: "evidence",
  name: "Evidence ledger",
  kind: "tool",
  description:
    "Exact figures from earlier tool results, by evidence id, so values survive context stubs and compaction.",
  settings: [],
  defaultConfig: { enabled: true },
  async createTools(_cfg, ctx) {
    return [evidenceGetTool(ctx)];
  },
};
