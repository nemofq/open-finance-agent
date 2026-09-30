/**
 * `parseAttachment(bytes, name)`: one document in, one `ParsedAttachment` out, whatever the format.
 * The parsers themselves are in the sibling modules; this file decides which one
 * gets the bytes, runs it in a worker thread under a time and memory cap, and derives the small
 * descriptor the transcript keeps.
 *
 * ## How the worker resolves
 *
 * `worker.ts` is started by absolute path, computed from `process.cwd()` rather than from
 * `import.meta.url`, and Node runs it as TypeScript source (type stripping is on by default in
 * Node 24, which `package.json` already requires). One path therefore works everywhere:
 *
 * - **vitest** — cwd is the repo root, and the source tree is the thing under test.
 * - **`next dev` / `next start`** — cwd is the repo root as well, and `src/` is beside `.next/`.
 *   The bundled copy of this module only spawns the worker; the worker loads `registry.ts` and the
 *   parser it names from source.
 *
 * Bundling the worker is what does *not* work: a `new Worker(new URL(…, import.meta.url))` points
 * into `.next/server/chunks`, and the parsers would have to be reachable from there. So this file
 * names parsers only by id, and the loaders live in `registry.ts`, which only the worker imports;
 * their dynamic imports carry `turbopackIgnore`, which keeps `mammoth`, `pdfjs-dist` and the rest
 * out of the server bundle entirely — they are only ever loaded inside the worker, from source.
 *
 * `OFA_PARSE_WORKER` overrides the path for a deployment that moves the sources elsewhere.
 *
 * Because nothing imports the worker, the build cannot trace it: `next.config.ts` names the
 * worker's modules for the upload route instead, and `worker.test.ts` checks that every module the
 * worker loads resolves from `src/`, stays inside `src/lib/attachments/`, is on that list, and
 * parses a real file.
 */

import path from "node:path";
import { Worker } from "node:worker_threads";
// Outside attachments/, which is fine here: the worker imports only this file's types, never its code.
import { textTokens } from "@/lib/context/tokens";
import { partsText, rowsTable } from "../digest";
import type { ParserId } from "../formats";
import { PARSE_MAX_OLD_GENERATION_MB, PARSE_TIMEOUT_MS } from "../limits";
import type { ParsedAttachment, StoredAttachment } from "../types";
import { type Sniffed, sniff } from "./sniff";


/** A parse that started but could not finish: a hostile file, a cap, or a broken one. */
export class ParseFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseFailed";
  }
}

/** What crosses into the worker. The bytes are transferred, not copied. */
export interface ParseRequest {
  parser: ParserId;
  name: string;
  bytes: ArrayBuffer;
}

export type ParseResponse = { ok: true; parsed: ParsedAttachment } | { ok: false; message: string };

/** The descriptor fields that come from the parse; the store adds the name, the file and the size. */
type ParsedFields = Pick<StoredAttachment, "kind" | "tokens" | "parts"> &
  Partial<Pick<StoredAttachment, "rows" | "truncated" | "scannedParts">>;

/* ------------------------------------------------------------ parent side */

interface WorkerBudget {
  timeoutMs: number;
  maxOldGenerationMb: number;
}

const PARSE_BUDGET: WorkerBudget = {
  timeoutMs: PARSE_TIMEOUT_MS,
  maxOldGenerationMb: PARSE_MAX_OLD_GENERATION_MB,
};

/** Where `worker.ts` lives, as a path Node can run. */
export function workerEntry(): string {
  return process.env.OFA_PARSE_WORKER || path.join(process.cwd(), "src", "lib", "attachments", "parse", "worker.ts");
}

/**
 * Run one worker to completion under a budget, and never leave it running. Exported so the harness
 * itself can be tested against a worker that hangs or allocates without a parser being involved.
 *
 * `execArgv: []` matters: a worker inherits the parent's Node options by default, and under vitest
 * the parent is itself a worker started with the runner's own loaders. A parse must begin from a
 * plain Node either way, or it would behave differently in tests than in the app.
 */
export function runInWorker<T>(entry: string, workerData: unknown, budget: WorkerBudget, transferList: ArrayBuffer[] = []): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const worker = new Worker(entry, {
      workerData,
      transferList,
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: budget.maxOldGenerationMb },
      // Parsers are chatty (pdf.js in particular). Their output belongs nowhere near the server log,
      // and an unread pipe would eventually block the worker, so both are drained and dropped.
      stdout: true,
      stderr: true,
    });
    worker.stdout.resume();
    worker.stderr.resume();

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
      void worker.terminate();
    };

    const timer = setTimeout(() => {
      finish(() => reject(new ParseFailed(`Reading the file took longer than ${Math.round(budget.timeoutMs / 1000)} seconds, so it was stopped.`)));
    }, budget.timeoutMs);
    // A pending parse must not hold a test runner or a shutdown open.
    timer.unref?.();

    worker.on("message", (message: T) => finish(() => resolve(message)));
    worker.on("error", (err: NodeJS.ErrnoException) => {
      finish(() =>
        reject(
          err.code === "ERR_WORKER_OUT_OF_MEMORY"
            ? new ParseFailed(`Reading the file needed more than ${budget.maxOldGenerationMb} MB of memory, so it was stopped.`)
            : new ParseFailed(err.message || "The file could not be read."),
        ),
      );
    });
    worker.on("exit", (code) => {
      finish(() => reject(new ParseFailed(`Reading the file stopped unexpectedly (exit ${code}).`)));
    });
  });
}

/**
 * Parse one uploaded file, as `sniffed` when the caller has already sniffed it. Throws
 * `UnsupportedAttachment` for something we do not take and `ParseFailed` for something we took and
 * could not read; both are the user's to act on, so the upload route hands the message straight back.
 */
export async function parseAttachment(bytes: Uint8Array, name: string, sniffed: Sniffed = sniff(bytes, name)): Promise<ParsedAttachment> {
  // A fresh copy, so the transfer below cannot detach a buffer the caller still holds — the route
  // writes the same bytes to disk after this returns.
  const copy = bytes.slice().buffer as ArrayBuffer;
  const request: ParseRequest = { parser: sniffed.parser, name, bytes: copy };
  const response = await runInWorker<ParseResponse>(workerEntry(), request, PARSE_BUDGET, [copy]);
  if (!response.ok) throw new ParseFailed(response.message);
  // The worker is the untrusted half of this: it ran a parser over a hostile file.
  return checkParsed(response.parsed, sniffed.kind);
}

/**
 * The descriptor fields a parse implies. Separated so a re-read of a sidecar can redo them.
 *
 * `scannedParts` is the pdf parser's to report — it is the only code that can tell a blank page
 * from a scanned one — and `pdf.ts` exports `scannedPages()` for a caller holding a sidecar that
 * wants them derived again. Nothing here imports it: this runs on the request thread, and reaching
 * into `./pdf` would pull pdf.js into the very bundle `registry.ts`'s `turbopackIgnore` keeps it out of.
 *
 * `truncated` is different. Every parser sets it when it hits a cap of its own, but a table is cut
 * by row count rather than by characters, and `AttachmentTablePart` records both sides of that, so
 * the cut is read off the part rather than taken on trust.
 */
export function describeParse(parsed: ParsedAttachment): ParsedFields {
  const cut = parsed.parts.some((part) => part.type === "table" && part.rows.length < part.totalRows);
  const rows = parsed.parts.reduce((total, part) => total + (part.type === "table" ? part.totalRows : 0), 0);
  return {
    kind: parsed.kind,
    tokens: textTokens(markdownOf(parsed)),
    parts: parsed.parts.length,
    // Omitted rather than zero: a document with no table in it has no row count, not a count of none.
    ...(rows > 0 ? { rows } : {}),
    ...(parsed.truncated || cut ? { truncated: true } : {}),
    ...(parsed.scannedParts?.length ? { scannedParts: parsed.scannedParts } : {}),
  };
}

/** A parse that came back from the worker malformed is a bug in a parser, not a broken file. */
function checkParsed(parsed: ParsedAttachment, kind: ParsedAttachment["kind"]): ParsedAttachment {
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.parts)) throw new ParseFailed("The file was read into something unusable.");
  return { ...parsed, kind: parsed.kind ?? kind, outline: parsed.outline ?? [], warnings: parsed.warnings ?? [] };
}

/* -------------------------------------------------------------- rendering */

/**
 * The normalised Markdown: what `GET …/[name]/text` returns and what the token estimate is taken
 * from.
 *
 * Prose goes in whole. A table never does — the model computes on tables through the calculator,
 * never by reading rows — so it becomes its size with the first ten rows, under its label even
 * when it is the only part: its digest holds no headings of its own to outrank, and the label is
 * the sheet's real name.
 */
export function markdownOf(parsed: ParsedAttachment): string {
  return partsText(parsed, (table) =>
    [
      ...(table.label ? [`## ${table.label}`, ""] : []),
      `${table.totalRows.toLocaleString("en-US")} rows × ${table.columns.length} columns.`,
      "",
      ...rowsTable(table),
    ].join("\n"),
  );
}
