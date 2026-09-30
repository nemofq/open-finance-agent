import type { JsonObject } from "@earendil-works/pi-ai";
import type { ToolSource } from "@/lib/tools/contracts";

/**
 * The evidence ledger: every figure the agent can use has an ID, a source and an
 * exact value that lives outside the model's context.
 *
 * Entry kinds: E retrieved, C computed, A assumption, U user-provided, R report.
 *
 * What a tool result's `details` carries is a type alias, not an interface: pi-ai types details
 * as JSON, and only an alias gets the implicit index signature that makes it one.
 */
export type EvidenceKind = "E" | "C" | "A" | "U" | "R";

/** `E7`, `C3`, `A1`, `U2`, `R1`: the kind letter followed by a per-session counter. */
export type EvidenceId = string;

export type EvidenceSource = Pick<ToolSource, "id" | "name" | "tier">;

export type EvidenceEntity = {
  ticker?: string;
  cik?: string;
  name?: string;
};

/** A number found in a result's text, with enough context to tell what it is. */
export type EvidenceNumber = {
  value: number;
  unit?: string;
  /** A short snippet around the number, e.g. "Revenue: $30,040M". */
  context: string;
};

/** A structured fact: one figure a tool read exactly from its source, rather than from prose. */
export type EvidenceFact = {
  /** Canonical metric name, e.g. `revenue`, `dilutedEps`, `close`, `eps_estimate`. */
  metric: string;
  /** Fiscal or calendar label the value refers to, e.g. `FY25 Q2`, `2024-08-28`, `FY2024`. */
  period: string;
  /** Measurement basis; an annual flow and a quarterly flow are different facts even at the same end date. */
  periodType?: "instant" | "quarterly" | "annual";
  value: number;
  /** `USD`, `USD/share`, `shares`, `%`, `ratio`, … */
  unit: string;
  /** Accession number, URL or vendor function that backs the fact. */
  ref?: string;
  /** For period-end facts, the date the period ended. */
  end?: string;
};

/** A tabular payload the calculator can preload as a pandas object. */
export type EvidenceTable = {
  columns: string[];
  rows: (string | number | null)[][];
  /** Column to use as the pandas index, when one is meaningful (`period`, `date`). */
  index?: string;
};

/**
 * What a data tool may attach to its result `details` so the ledger indexes it exactly
 * instead of extracting numbers from prose. Every field is optional; the normalizer fills
 * in what is missing from the text.
 */
export type StructuredDetails = {
  /**
   * The entry's one-line summary, e.g. "EDGAR income statement, quarterly, $NVDA, 8 periods". A
   * result that brings one is taken to state its own `asOf`: no date is read from its text.
   */
  summary?: string;
  /**
   * The figures worth sourcing when there are no facts, when the text holds more than those
   * figures (an API's scores and ids). Omitted, every number in the text is taken.
   */
  numbers?: EvidenceNumber[];
  /** Publication/disclosure time, distinct from the period the data describes. */
  availableAt?: string;
  /** Date the data refers to (YYYY-MM-DD), e.g. the latest filing or trading date in the result. */
  asOf?: string;
  entity?: EvidenceEntity;
  facts?: EvidenceFact[];
  table?: EvidenceTable;
  periods?: string[];
  unit?: string;
  currency?: string;
  /** Overrides the tool's declared source, e.g. a web page whose domain is sec.gov. */
  source?: EvidenceSource;
};

export type EvidenceConflict = {
  /** The other entry reporting the same fact. */
  with: EvidenceId;
  metric: string;
  period: string;
  value: number;
  otherValue: number;
  /** Within tolerance of each other. */
  agree: boolean;
};

export type EvidenceEntry = {
  availableAt?: string;
  id: EvidenceId;
  kind: EvidenceKind;
  /** One line the model and the UI can show, e.g. "EDGAR income statement, quarterly, $NVDA, 8 periods". */
  summary: string;
  /* Origin */
  tool?: string;
  toolCallId?: string;
  /** The call's arguments as the tool validated them. */
  args?: JsonObject;
  source?: EvidenceSource;
  /* Subject */
  entity?: EvidenceEntity;
  periods?: string[];
  unit?: string;
  currency?: string;
  /* Timing and integrity */
  /** Date the data refers to. */
  asOf?: string;
  /** ISO 8601 instant the entry was created. */
  fetchedAt: string;
  /** SHA-256 of the full payload, when one was stored. */
  hash?: string;
  /** True when the entry is dated after the turn's as-of date. */
  lookAhead?: boolean;
  /* Content */
  numbers?: EvidenceNumber[];
  facts?: EvidenceFact[];
  table?: EvidenceTable;
  /** True when the full payload is stored under `sessions/<id>/evidence/<entry>.json`. */
  hasPayload?: boolean;
  conflicts?: EvidenceConflict[];
  /* Single-figure entries: C, A, U */
  name?: string;
  value?: number;
  /* C entries */
  formula?: string;
  inputs?: EvidenceId[];
  finVersion?: string;
  /* A entries */
  why?: string;
  /** False for a numeric constant discovered without an explicit assumption declaration. */
  declared?: boolean;
  /* U entries */
  origin?: "message" | "profile" | "holdings" | "attachment";
  /**
   * The document an `origin: "attachment"` entry came from: the content-addressed file name, and
   * the index of the part when the entry is one worksheet rather than the whole file. It is what
   * lets the model path find the id of a table it is about to describe.
   */
  attachment?: { file: string; part?: number };
  /* R entries */
  report?: { title: string };
};

/**
 * The report validator's per-figure outcome, the single account of what a delivered report's
 * figures rest on: `checked` counts prose figures, numeric cells and references; `supported` those
 * with no issue. `unverified` excludes `repaired`; `byKind` splits the unverified issues.
 */
export type ReportVerification = {
  checked: number;
  supported: number;
  repaired: number;
  unverified: number;
  byKind: { values: number; sources: number; references: number; structure: number };
};

/** A number found in model output or a report cell, before it is matched to the ledger. */
export interface Figure {
  raw: string;
  value: number;
  unit?: string;
  /** Character offset in the source text. */
  index: number;
  /** Why the figure is exempt from matching (year, date, fiscal label, ticker, small count). */
  exempt?: "year" | "date" | "fiscal" | "ticker" | "count" | "ordinal" | "id";
}

export interface FigureMatch {
  figure: Figure;
  /** Available entries supporting the figure and its citation; empty means unsupported. */
  matches: EvidenceId[];
  /** Equal values elsewhere, offered only as repair hints; these do not validate the claim. */
  candidates?: EvidenceId[];
  /** The bracketed citation read for the figure and its offset in the text. */
  citation?: { at: number; text: string };
}

/** What `afterToolCall` stores on a `ToolResultMessage.details` so a chat rebuilds its ledger on load. */
export type EvidenceDetails = {
  evidence?: EvidenceEntry | EvidenceEntry[];
};

export interface FactQuery {
  entity?: EvidenceEntity;
  metric?: string;
  period?: string;
}

/**
 * The per-session ledger. Entries are kept in memory and rebuilt from the transcript when a
 * chat loads; full payloads live on disk. Implemented in `src/lib/evidence/ledger.ts`.
 */
export interface EvidenceLedger {
  readonly sessionId: string;
  /** All entries, in id order. */
  list(kind?: EvidenceKind): EvidenceEntry[];
  get(id: EvidenceId): EvidenceEntry | undefined;
  /** Allocate the next id of `kind` and add the entry. */
  add(entry: Omit<EvidenceEntry, "id" | "fetchedAt"> & { fetchedAt?: string }): EvidenceEntry;
  /**
   * Store the full payload of an entry (the raw tool result, a report spec and HTML, …).
   *
   * `onlyIfMissing` is for a payload that is rebuilt identically on every turn — an attached
   * worksheet too large to carry inline — so replaying a transcript does not rewrite
   * megabytes it already holds.
   */
  savePayload(id: EvidenceId, payload: unknown, options?: { onlyIfMissing?: boolean }): Promise<void>;
  loadPayload<T = unknown>(id: EvidenceId): Promise<T | undefined>;
  /** Facts matching a query across E entries, newest first. */
  findFacts(query: FactQuery): { entry: EvidenceEntry; fact: EvidenceFact }[];
  /** Entries holding `value` at the precision shown (numbers, facts, table cells, or the single value). */
  matchValue(figure: Figure): EvidenceId[];
  /** Wait for pending payload writes. */
  flush(): Promise<void>;
}
