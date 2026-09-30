/**
 * The syntax of evidence ids and report references, written down once. Browser-safe: it imports
 * nothing but types, so the chat renders the same ids and references the server writes.
 *
 * An id is a kind letter and a counter, `E7`: E retrieved, C computed, A assumed, U given by the
 * user, R a report. A figure cites one of the first four; a report holds no figure of its own.
 * A reference is an id in braces with an optional path, `{C3}`, `{C3:label}` or
 * `{E7:revenue:FY26 Q2}`, which the renderer replaces with the figure it names.
 */
import type { EvidenceDetails, EvidenceEntry, EvidenceId, EvidenceKind } from "./types";

/** Every kind, in the order the ledger lists them. */
const EVIDENCE_KINDS = ["E", "C", "A", "U", "R"] as const satisfies readonly EvidenceKind[];

/** The kinds a figure can cite: all but R. */
const CITABLE_KINDS = ["E", "C", "A", "U"] as const satisfies readonly EvidenceKind[];

/** Regular-expression sources for one kind letter and one citable kind letter, to build patterns from. */
export const KIND_CLASS = `[${EVIDENCE_KINDS.join("")}]`;
export const CITABLE_CLASS = `[${CITABLE_KINDS.join("")}]`;

/** An id exactly as the ledger generates it: no leading zero, at most six digits. */
const ID_RE = new RegExp(`^(${KIND_CLASS})([1-9]\\d{0,5})$`);

/** Ids are generated as `E7`; anything else reaching the filesystem is a bug or a bad model call. */
export function isEvidenceId(id: string): id is EvidenceId {
  return ID_RE.test(id);
}

export function parseId(id: string): { kind: EvidenceKind; index: number } | undefined {
  const match = ID_RE.exec(id);
  if (!match) return undefined;
  return { kind: match[1] as EvidenceKind, index: Number(match[2]) };
}

/** Ledger order: by kind, E before C before A before U before R, then by counter. */
export function compareIds(a: EvidenceId, b: EvidenceId): number {
  const left = parseId(a);
  const right = parseId(b);
  if (!left || !right) return a.localeCompare(b);
  const byKind = EVIDENCE_KINDS.indexOf(left.kind) - EVIDENCE_KINDS.indexOf(right.kind);
  return byKind !== 0 ? byKind : left.index - right.index;
}

/** Every id-shaped word in a text, in order, repeats included: what a summary or window cites. */
export function mentionedIds(text: string): string[] {
  return text.match(new RegExp(`\\b${KIND_CLASS}\\d+\\b`, "g")) ?? [];
}

function isEntry(value: unknown): value is EvidenceEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<EvidenceEntry>;
  return typeof entry.id === "string" && parseId(entry.id)?.kind === entry.kind;
}

/**
 * The entries a tool result carries on its `details`, which is what pi persists on the
 * `ToolResultMessage` and therefore what a reloaded chat rebuilds its ledger from.
 */
export function evidenceOf(details: unknown): EvidenceEntry[] {
  if (!details || typeof details !== "object") return [];
  const carried = (details as EvidenceDetails).evidence;
  if (!carried) return [];
  return (Array.isArray(carried) ? carried : [carried]).filter(isEntry);
}

/* ------------------------------------------------------------ references */

/**
 * A reference in text: the id's kind and counter, then the path as written after it. Use it only
 * with `matchAll` or `replace`, which do not carry its position from one text to the next.
 */
const REFERENCE_RE = new RegExp(`\\{(${CITABLE_CLASS})(\\d+)((?::[^{}:]*)*)\\}`, "g");

export interface ReferenceHit {
  /** The reference exactly as written, e.g. `{E7:revenue:FY26 Q2}`. */
  raw: string;
  id: EvidenceId;
  /** Empty for a scalar; `[label]` for a calculated series; `[metric, period]` for a fact. */
  path: string[];
  /** Character offset of `raw` in the text it came from. */
  index: number;
}

/** Every reference in a piece of text, in the order it appears. */
export function findReferences(text: string): ReferenceHit[] {
  const hits: ReferenceHit[] = [];
  for (const match of text.matchAll(REFERENCE_RE)) {
    const [raw, kind, number, tail] = match;
    hits.push({
      raw,
      id: `${kind}${number}`,
      // A series label may hold a colon; a metric and a period may not.
      path: tail === "" ? [] : kind === "C" ? [tail.slice(1)] : tail.slice(1).split(":").map((part) => part.trim()),
      index: match.index,
    });
  }
  return hits;
}

const CITABLE_ID_RE = new RegExp(`^${CITABLE_CLASS}\\d+$`);

/**
 * The reference to `id` at `path`, as `findReferences` reads it back, or undefined when the path
 * cannot be written: a brace or a line break anywhere, or a colon outside a calculated series.
 * Report tokens are copied verbatim; a label that cannot be represented needs an evidence table.
 */
export function reportReference(id: string, ...path: string[]): string | undefined {
  if (!CITABLE_ID_RE.test(id) || path.some((part) => /[{}\n\r]/.test(part) || (!id.startsWith("C") && part.includes(":")))) return undefined;
  return `{${[id, ...path].join(":")}}`;
}
