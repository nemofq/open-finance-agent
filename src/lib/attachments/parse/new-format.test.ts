/**
 * The new-format recipe, walked end to end with a format that exists only in this test: a parser
 * module, a row in the format table, a loader in the registry, and bytes uploaded through
 * `parseAttachment` into the real worker thread.
 *
 * No production seam is involved. The format table is a plain record this test adds a row to and
 * removes again; the loader is added inside the worker thread by a small entry script that
 * registers it on the real `registry.ts` and then runs the real `worker.ts`, which the existing
 * `OFA_PARSE_WORKER` override points `parseAttachment` at. The parser imports through `@/`, so the
 * worker's alias root is exercised as well.
 *
 * Storing and serving need more than a row added at run time: `formats.ts` derives the stored-name
 * pattern and the composer's `accept` list from the table when it loads. So the last case does
 * what a contributor does, adding the row to the source, on a copy of the real `formats.ts`, and
 * loads the store and the serve route fresh against that copy.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DOCUMENT_TYPES, type DocumentType, supported } from "../formats";
import { PARSE_MAX_OLD_GENERATION_MB } from "../limits";
import { claimDocuments, InvalidDocuments } from "../documents";
import { describeParse, markdownOf, parseAttachment, type ParseRequest, type ParseResponse, runInWorker, workerEntry } from "./index";
import { PARSERS } from "./registry";
import { UnsupportedAttachment } from "./sniff";

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE = "fake-note";

let scratch: string;
let entry: string;

beforeAll(() => {
  scratch = mkdtempSync(path.join(tmpdir(), "ofa-new-format-"));
  // 1. The parser: `bytes + filename → ParsedAttachment`, one text part per line.
  const parser = path.join(scratch, "fake-note.ts");
  writeFileSync(
    parser,
    [
      'import { MAX_TEXT_CHARS } from "@/lib/attachments/limits";',
      'import type { ParsedAttachment } from "@/lib/attachments/types";',
      "export async function parse(bytes: Uint8Array, name: string): Promise<ParsedAttachment> {",
      "  const lines = new TextDecoder().decode(bytes).slice(0, MAX_TEXT_CHARS).split(/\\r?\\n/).filter(Boolean);",
      '  const parts = lines.map((line, index) => ({ type: "text" as const, label: `Note ${index + 1}`, markdown: line }));',
      '  return { version: 1, kind: "document", parts, outline: [], warnings: [`${name} read by the test-only parser.`] };',
      "}",
      "",
    ].join("\n"),
  );
  // 2. The registry line, added inside the worker thread before the real worker runs.
  entry = path.join(scratch, "worker-with-fake-note.mjs");
  writeFileSync(
    entry,
    [
      `const { PARSERS } = await import(${JSON.stringify(pathToFileURL(path.join(here, "registry.ts")).href)});`,
      `PARSERS[${JSON.stringify(FAKE)}] = () => import(${JSON.stringify(pathToFileURL(parser).href)});`,
      `await import(${JSON.stringify(pathToFileURL(path.join(here, "worker.ts")).href)});`,
      "",
    ].join("\n"),
  );
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** 3. The format-table row, for as long as `run` takes. */
async function withFakeFormat<T>(run: () => Promise<T>): Promise<T> {
  const types = DOCUMENT_TYPES as Record<string, DocumentType>;
  const previous = process.env.OFA_PARSE_WORKER;
  types.fnote = { parser: FAKE as DocumentType["parser"], kind: "document", containers: ["plain"], mimeType: "text/plain" };
  process.env.OFA_PARSE_WORKER = entry;
  try {
    return await run();
  } finally {
    delete types.fnote;
    if (previous === undefined) delete process.env.OFA_PARSE_WORKER;
    else process.env.OFA_PARSE_WORKER = previous;
  }
}

describe("adding a format", () => {
  it("parses the new extension through the real worker once its parser, row and loader exist", async () => {
    const parsed = await withFakeFormat(() => parseAttachment(new TextEncoder().encode("first line\nsecond line\n"), "memo.fnote"));
    expect(parsed.parts).toEqual([
      { type: "text", label: "Note 1", markdown: "first line" },
      { type: "text", label: "Note 2", markdown: "second line" },
    ]);
    expect(parsed.warnings).toEqual(["memo.fnote read by the test-only parser."]);
    expect(describeParse(parsed)).toMatchObject({ kind: "document", parts: 2 });
    expect(markdownOf(parsed)).toBe("## Note 1\n\nfirst line\n\n## Note 2\n\nsecond line");
  });

  it("leaves the production format table and registry without it", async () => {
    expect(supported("memo.fnote")).toBeUndefined();
    expect(Object.hasOwn(PARSERS, FAKE)).toBe(false);
    await expect(parseAttachment(new TextEncoder().encode("a line"), "memo.fnote")).rejects.toThrow(UnsupportedAttachment);

    // The production worker, asked for the id directly, has no loader for it either.
    const bytes = new TextEncoder().encode("a line").slice().buffer as ArrayBuffer;
    const request = { parser: FAKE, name: "memo.fnote", bytes } as unknown as ParseRequest;
    const response = await runInWorker<ParseResponse>(workerEntry(), request, { timeoutMs: 20_000, maxOldGenerationMb: PARSE_MAX_OLD_GENERATION_MB }, [bytes]);
    expect(response).toEqual({ ok: false, message: `No parser is registered as "${FAKE}".` });

    // And the production store refuses the name before it looks for a file.
    await expect(claimDocuments("new-format", [`${"0".repeat(40)}.fnote`])).rejects.toThrow(InvalidDocuments);
  });
});

/** 4. The row as a contributor writes it: in the source, here of a copy of `formats.ts`. */
function formatsWithFakeRow(): string {
  const source = readFileSync(path.join(here, "..", "formats.ts"), "utf8");
  const anchor = "const DOCUMENT_ROWS = {\n";
  expect(source, `formats.ts no longer opens its table with: ${anchor}`).toContain(anchor);
  const row = `  fnote: { parser: ${JSON.stringify(FAKE)}, kind: "document", containers: ["plain"], mimeType: "text/plain" },\n`;
  const edited = source.replace(anchor, anchor + row);
  const copy = path.join(scratch, "formats.ts");
  writeFileSync(copy, edited);
  return pathToFileURL(copy).href;
}

describe("storing and serving the new format", () => {
  let home: string;
  const previous = { home: process.env.OFA_HOME, worker: process.env.OFA_PARSE_WORKER };

  beforeAll(() => {
    home = mkdtempSync(path.join(tmpdir(), "ofa-new-format-home-"));
    process.env.OFA_HOME = home;
    process.env.OFA_PARSE_WORKER = entry;
    const copy = formatsWithFakeRow();
    vi.resetModules();
    vi.doMock("../formats", () => import(/* @vite-ignore */ copy));
  });

  afterAll(() => {
    vi.doUnmock("../formats");
    vi.resetModules();
    for (const [name, value] of [["OFA_HOME", previous.home], ["OFA_PARSE_WORKER", previous.worker]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(home, { recursive: true, force: true });
  });

  it("offers, stages, claims and serves the extension once its row is in formats.ts", async () => {
    const formats = await import("../formats");
    const documents = await import("../documents");
    const { createSession } = await import("@/lib/sessions/store");
    const { GET } = await import("@/app/api/sessions/[id]/attachments/[name]/route");
    expect(formats.accept.split(",")).toContain(".fnote");

    const bytes = new TextEncoder().encode("first line\nsecond line\n");
    const staged = await documents.stageDocument(bytes, "memo.fnote");
    expect(staged.stored).toMatchObject({ name: "memo.fnote", attachment: expect.stringMatching(/^[0-9a-f]{40}\.fnote$/) });
    expect(staged.parsed.parts).toHaveLength(2);

    const session = await createSession({ model: { provider: "lab", model: "qwen3" } });
    const [claimed] = await documents.claimDocuments(session.id, [staged.stored.attachment]);
    expect(claimed).toEqual(staged.stored);

    const response = await GET(new Request("http://localhost/"), { params: Promise.resolve({ id: session.id, name: claimed.attachment }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/plain");
    expect(response.headers.get("Content-Disposition")).toContain('filename="memo.fnote"');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });
});
