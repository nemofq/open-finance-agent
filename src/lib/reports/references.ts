import { findReferences, type ReferenceHit } from "@/lib/evidence/ids";
import { factsFor } from "@/lib/evidence/metrics";
import type { EvidenceEntry, EvidenceId, EvidenceLedger } from "@/lib/evidence/types";
import { formatCell } from "./format";

/**
 * Figures inside report prose are written as references into the evidence ledger, never as
 * literals: `{C3}` for a scalar, `{C3:label}` for a calculated series item,
 * and `{E7:revenue:FY26 Q2}` for one fact of a retrieved source. The syntax is in
 * `src/lib/evidence/ids.ts`; this file resolves a reference against the ledger.
 */

export interface ResolvedReference {
  hit: ReferenceHit;
  entry: EvidenceEntry;
  /** The figure as the report prints it, e.g. `USD 4.32B`. */
  text: string;
  value: number;
  unit?: string;
  /** The period the figure refers to, when the reference named one. */
  period?: string;
}

export type ReferenceResolution =
  | { ok: true; reference: ResolvedReference }
  | { ok: false; hit: ReferenceHit; message: string };

function resolveFact(hit: ReferenceHit, entry: EvidenceEntry): ReferenceResolution {
  const [metric, period] = hit.path;
  const facts = entry.facts ?? [];
  if (facts.length === 0) {
    return {
      ok: false,
      hit,
      message: `${hit.raw}: ${entry.id} carries no structured facts, so it cannot be referenced by metric. For a source figure, use a literal cell with value and src, or write the value with its [source id] citation in prose. Only derived figures need the calculator.`,
    };
  }
  const [fact] = factsFor(entry, period, metric);
  if (fact === undefined) {
    const sample = facts
      .slice(0, 6)
      .map((candidate) => `${candidate.metric}:${candidate.period}`)
      .join(", ");
    return {
      ok: false,
      hit,
      message: `${hit.raw}: ${entry.id} has no fact "${metric}" for "${period}". It holds ${sample}.`,
    };
  }
  return {
    ok: true,
    reference: { hit, entry, text: formatCell(fact.value, fact.unit), value: fact.value, unit: fact.unit, period: fact.period },
  };
}

/**
 * Turn one reference into the figure it stands for, or say why it cannot be resolved. It needs only
 * `get`, so the chat can resolve against the entries its tool results carried.
 */
export function resolveReference(hit: ReferenceHit, ledger: Pick<EvidenceLedger, "get">): ReferenceResolution {
  const entry = ledger.get(hit.id);
  if (entry === undefined) {
    return { ok: false, hit, message: `${hit.raw}: ${hit.id} is not in the evidence ledger.` };
  }

  if (entry.lookAhead) return { ok: false, hit, message: `${hit.raw}: ${entry.id} was not available at the turn cutoff.` };

  const table = entry.table;
  if (entry.kind === "C" && table?.index) {
    const key = table.columns.indexOf(table.index);
    const row = hit.path.length === 1 ? table.rows.find((row) => String(row[key]) === hit.path[0]) : undefined;
    const value = row?.[table.columns.indexOf("value")];
    if (typeof value === "number" && Number.isFinite(value)) {
      return { ok: true, reference: { hit, entry, text: formatCell(value, entry.unit), value, unit: entry.unit, period: hit.path[0] } };
    }
    return { ok: false, hit, message: `${hit.raw}: ${entry.id} is a calculated series. Use {${entry.id}:label}, copying the exact label from its values, or an evidence_table with source "${entry.id}" for the whole series.` };
  }

  if (hit.path.length === 0) {
    if (typeof entry.value !== "number") {
      return {
        ok: false,
        hit,
        message: `${hit.raw}: ${entry.id} holds no single value. ${entry.facts?.length ? `Reference a fact as {${entry.id}:metric:period}.` : entry.table ? `Use an evidence_table block with source "${entry.id}".` : `Write the source value with a [${entry.id}] citation.`}`,
      };
    }
    return {
      ok: true,
      reference: { hit, entry, text: formatCell(entry.value, entry.unit), value: entry.value, unit: entry.unit },
    };
  }

  if (hit.path.length !== 2) {
    return {
      ok: false,
      hit,
      message: `${hit.raw}: a reference is either {${entry.id}} for a single value or {${entry.id}:metric:period} for one fact.`,
    };
  }

  return resolveFact(hit, entry);
}

export interface RewriteOptions {
  /** What a resolved reference becomes in the output. */
  reference: (reference: ResolvedReference) => string;
  /** What an unresolved reference becomes; by default it is left exactly as written. */
  unresolved?: (hit: ReferenceHit, message: string) => string;
  /** Applied to the text between references, e.g. HTML escaping. */
  literal?: (chunk: string) => string;
}

export interface RewrittenText {
  text: string;
  /** Entries the text drew a figure from, in first-use order. */
  used: EvidenceId[];
  problems: { hit: ReferenceHit; message: string }[];
}

/** Replace every reference in `text`, collecting the entries used and the ones that failed. */
export function rewriteReferences(
  text: string,
  ledger: EvidenceLedger,
  options: RewriteOptions,
): RewrittenText {
  const literal = options.literal ?? ((chunk: string) => chunk);
  const unresolved = options.unresolved ?? ((hit: ReferenceHit) => hit.raw);
  const used: EvidenceId[] = [];
  const problems: { hit: ReferenceHit; message: string }[] = [];

  let out = "";
  let cursor = 0;
  for (const hit of findReferences(text)) {
    out += literal(text.slice(cursor, hit.index));
    const resolution = resolveReference(hit, ledger);
    if (resolution.ok) {
      if (!used.includes(hit.id)) used.push(hit.id);
      out += options.reference(resolution.reference);
    } else {
      problems.push({ hit, message: resolution.message });
      out += unresolved(hit, resolution.message);
    }
    cursor = hit.index + hit.raw.length;
  }
  out += literal(text.slice(cursor));

  return { text: out, used, problems };
}

/** Inline code spans and fenced blocks, where reference syntax is being explained, not used. */
const CODE_RE = /(`+)[\s\S]*?\1|^ {0,3}(~{3,})[^\n]*\n[\s\S]*?^ {0,3}\2[ \t]*(?:\n|$)/gm;

/**
 * Resolve the references in prose (outside code) into the value and its `[id]` citation, the
 * form a chat answer cites evidence in. Unresolvable references stay exactly as written.
 */
export function resolveProse(text: string, ledger: EvidenceLedger): RewrittenText {
  const out: RewrittenText = { text: "", used: [], problems: [] };
  const rewrite = (chunk: string) => {
    const done = rewriteReferences(chunk, ledger, { reference: (ref) => `${ref.text} [${ref.hit.id}]` });
    out.used.push(...done.used.filter((id) => !out.used.includes(id)));
    out.problems.push(...done.problems);
    return done.text;
  };
  let cursor = 0;
  for (const code of text.matchAll(CODE_RE)) {
    out.text += rewrite(text.slice(cursor, code.index)) + code[0];
    cursor = code.index + code[0].length;
  }
  out.text += rewrite(text.slice(cursor));
  return out;
}
