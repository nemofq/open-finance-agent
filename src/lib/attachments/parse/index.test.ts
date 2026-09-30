import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PARSE_MAX_OLD_GENERATION_MB } from "../limits";
import type { AttachmentTablePart, ParsedAttachment } from "../types";
import { describeParse, markdownOf, parseAttachment, ParseFailed, type ParseRequest, type ParseResponse, runInWorker, workerEntry } from "./index";
import { PARSERS } from "./registry";
import { sniff, sniffContainer, UnsupportedAttachment } from "./sniff";

let scratch: string;

beforeAll(() => {
  scratch = mkdtempSync(path.join(tmpdir(), "ofa-parse-"));
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/* ------------------------------------------------------------- fixtures */

const utf8 = (text: string) => new TextEncoder().encode(text);

/** A zip's local file header, which is all the sniffer reads. */
const zip = () => new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
const ole2 = () => new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const pdf = () => utf8("%PDF-1.7\n1 0 obj\n");

/** A worker written for one test, run through the same harness the parsers use. */
function worker(name: string, body: string): string {
  const file = path.join(scratch, `${name}.mjs`);
  writeFileSync(file, body);
  return file;
}

/* ---------------------------------------------------------------- sniff */

describe("sniffing the container", () => {
  it("reads the magic bytes of each container we handle", () => {
    expect(sniffContainer(zip())).toBe("zip");
    expect(sniffContainer(ole2())).toBe("ole2");
    expect(sniffContainer(pdf())).toBe("pdf");
    expect(sniffContainer(utf8("# A memo\n"))).toBe("plain");
  });

  it("finds a %PDF header that junk bytes pushed off the start", () => {
    const bytes = new Uint8Array([...utf8("\n\n   "), ...pdf()]);
    expect(sniffContainer(bytes)).toBe("pdf");
  });
});

describe("choosing a parser", () => {
  it("routes each extension to its parser", () => {
    expect(sniff(utf8("hello"), "notes.md").parser).toBe("text");
    expect(sniff(utf8("<p>hi</p>"), "page.html").parser).toBe("html");
    expect(sniff(utf8("a,b\n1,2\n"), "rows.csv").parser).toBe("tabular");
    expect(sniff(zip(), "memo.docx").parser).toBe("docx");
    expect(sniff(zip(), "deck.pptx").parser).toBe("pptx");
    expect(sniff(zip(), "book.xlsx").parser).toBe("tabular");
    expect(sniff(ole2(), "memo.doc").parser).toBe("legacy-doc");
    expect(sniff(pdf(), "filing.pdf").parser).toBe("pdf");
  });

  it("believes the bytes over the name for a pdf", () => {
    const sniffed = sniff(pdf(), "filing.txt");
    expect(sniffed.parser).toBe("pdf");
    // The stored name takes this extension, so the download is a pdf rather than a mislabelled text file.
    expect(sniffed.extension).toBe("pdf");
    expect(sniffed.kind).toBe("pdf");
  });

  it("refuses a file whose contents are not the format it is named for", () => {
    expect(() => sniff(zip(), "notes.txt")).toThrow(UnsupportedAttachment);
    expect(() => sniff(zip(), "notes.txt")).toThrow(/zip archive/);
    expect(() => sniff(utf8("not a zip"), "memo.docx")).toThrow(/not really a .docx/);
    expect(() => sniff(ole2(), "page.html")).toThrow(/old binary Office file/);
  });

  it("names an Open XML file wrapped in OLE2 for what it is: password-protected", () => {
    for (const name of ["memo.docx", "book.xlsx", "deck.pptx"]) {
      expect(() => sniff(ole2(), name)).toThrow(`${name} is password-protected. Remove the password and attach it again.`);
    }
  });

  it("refuses a binary workbook under a spreadsheet's other name", () => {
    expect(() => sniff(ole2(), "rows.csv")).toThrow(/old binary Office file/);
  });

  it("explains .ppt and .xls rather than calling them unsupported", () => {
    expect(() => sniff(ole2(), "deck.ppt")).toThrow(/Save as \.pptx and attach again/);
    // Whatever the bytes: a broker's `.xls` is as often an html table as a real binary workbook.
    for (const bytes of [ole2(), utf8("<table><tr><td>1</td></tr></table>")]) {
      expect(() => sniff(bytes, "holdings.xls")).toThrow(/Save as \.xlsx or \.csv and attach again/);
    }
  });

  it("refuses an empty file and one with no extension", () => {
    expect(() => sniff(new Uint8Array(), "empty.txt")).toThrow(/empty/);
    expect(() => sniff(utf8("hello"), "README")).toThrow(/no file extension/);
    expect(() => sniff(utf8("hello"), "archive.zip")).toThrow(/cannot be attached/);
  });
});

/* --------------------------------------------------------------- worker */

describe("the worker harness", () => {
  const budget = { timeoutMs: 1_500, maxOldGenerationMb: 32 };

  it("returns what the worker posts", async () => {
    const entry = worker("echo", `import { parentPort, workerData } from "node:worker_threads";\nparentPort.postMessage({ echoed: workerData });\n`);
    await expect(runInWorker(entry, { a: 1 }, budget)).resolves.toEqual({ echoed: { a: 1 } });
  });

  it("stops a parser that never finishes", async () => {
    const entry = worker("hang", `while (true) {}\n`);
    await expect(runInWorker(entry, null, budget)).rejects.toThrow(/took longer than 2 seconds/);
  });

  it("stops a parser that allocates past its heap", async () => {
    // Held in an array so nothing can be collected; a zip bomb's decompressed side looks like this.
    const entry = worker("greedy", `const held = [];\nwhile (true) held.push(new Array(1_000_000).fill("x"));\n`);
    await expect(runInWorker(entry, null, budget)).rejects.toThrow(/more than 32 MB of memory/);
  });

  it("turns a throw inside the worker into a ParseFailed", async () => {
    const entry = worker("boom", `throw new Error("the file is corrupt");\n`);
    await expect(runInWorker(entry, null, budget)).rejects.toThrow(ParseFailed);
    await expect(runInWorker(entry, null, budget)).rejects.toThrow(/the file is corrupt/);
  });

  it("fails clearly when the worker entry is missing", async () => {
    await expect(runInWorker(path.join(scratch, "absent.mjs"), null, budget)).rejects.toThrow(ParseFailed);
  });
});

/**
 * Node runs `worker.ts` and everything it imports as source, stripping types without understanding
 * them. A parser that imported a type without `import type`, or used syntax that is not erasable,
 * would therefore fail to *load* — and would do so only in the app, never in a test that imports it
 * through vitest's own transform. This is the test that catches that: it boots the real worker,
 * which imports `registry.ts` and runs each of its loaders from source.
 *
 * Each parser is handed bytes it cannot make sense of: what it does with them is its own business,
 * but the failure must come from the file, not from the module.
 */
describe("every parser loads inside the worker", () => {
  // Every loader in the registry the worker dispatches through, so a new parser is covered by adding it.
  const parsers = Object.keys(PARSERS) as (keyof typeof PARSERS)[];
  const loadFailure = /Cannot find module|does not provide an export|ERR_MODULE_NOT_FOUND|ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING|Unexpected token|Unexpected reserved word|TypeScript/i;

  it.each(parsers)("loads ./%s", async (parser) => {
    const bytes = utf8("not really a document").slice().buffer as ArrayBuffer;
    const request: ParseRequest = { parser, name: `probe.${parser}`, bytes };
    const response = await runInWorker<ParseResponse>(workerEntry(), request, { timeoutMs: 20_000, maxOldGenerationMb: PARSE_MAX_OLD_GENERATION_MB }, [bytes]);
    if (response.ok) return; // a parser that made something of the bytes has certainly loaded
    expect(response.message, `./${parser} failed to load in the worker rather than failing to parse`).not.toMatch(loadFailure);
  });

  it("dispatches through the registry, which names the id it has no loader for", async () => {
    const bytes = utf8("hello").slice().buffer as ArrayBuffer;
    const request = { parser: "rtf", name: "probe.rtf", bytes } as unknown as ParseRequest;
    const response = await runInWorker<ParseResponse>(workerEntry(), request, { timeoutMs: 20_000, maxOldGenerationMb: PARSE_MAX_OLD_GENERATION_MB }, [bytes]);
    expect(response).toEqual({ ok: false, message: 'No parser is registered as "rtf".' });
  });
});

/* ------------------------------------------------------- parseAttachment */

describe("parseAttachment", () => {
  it("parses a markdown file end to end and describes it", async () => {
    const source = "# Q3 memo\n\nRevenue rose 4%.\n";
    const parsed = await parseAttachment(utf8(source), "memo.md");
    const fields = describeParse(parsed);
    expect(parsed.version).toBe(1);
    expect(parsed.kind).toBe("document");
    expect(parsed.parts.length).toBeGreaterThan(0);
    expect(fields.kind).toBe("document");
    expect(fields.parts).toBe(parsed.parts.length);
    expect(fields.tokens).toBeGreaterThan(0);
    expect(markdownOf(parsed)).toContain("Revenue rose 4%");
  });

  it("leaves the caller's bytes usable after transferring a copy to the worker", async () => {
    const bytes = utf8("# Still here\n");
    await parseAttachment(bytes, "memo.md");
    expect(bytes.length).toBeGreaterThan(0);
    expect(new TextDecoder().decode(bytes)).toContain("Still here");
  });

  it("refuses what it cannot parse before starting a worker", async () => {
    await expect(parseAttachment(zip(), "notes.txt")).rejects.toThrow(UnsupportedAttachment);
  });
});

/* ---------------------------------------------------------- normalisation */

function table(rows: number): ParsedAttachment {
  const part: AttachmentTablePart = {
    type: "table",
    label: "Holdings",
    columns: ["Symbol", "Value | USD"],
    rows: Array.from({ length: Math.min(rows, 25) }, (_, index) => [`SYM${index}`, index * 100]),
    totalRows: rows,
  };
  return { version: 1, kind: "table", parts: [part], outline: [], warnings: [] };
}

describe("the normalised markdown", () => {
  it("shows a table as a schema digest, not as rows", () => {
    const markdown = markdownOf(table(2_410));
    expect(markdown).toContain("## Holdings");
    expect(markdown).toContain("2,410 rows × 2 columns");
    expect(markdown).toContain("_First 10 of 2,410 rows._");
    expect(markdown).toContain("SYM9");
    expect(markdown).not.toContain("SYM10");
    // A pipe inside a cell would otherwise end the column early.
    expect(markdown).toContain("Value \\| USD");
  });

  it("says nothing about a cut when the whole table is there", () => {
    expect(markdownOf(table(3))).not.toContain("First");
  });

  it("keeps a lone table's label, which names the sheet", () => {
    expect(markdownOf(table(3))).toContain("## Holdings");
  });

  it("puts no heading above a document that is all one part", () => {
    // "## Document" over the file's own "# Q3 memo" would make every heading below it a level out.
    const parsed: ParsedAttachment = {
      version: 1,
      kind: "document",
      parts: [{ type: "text", label: "Document", markdown: "# Q3 memo\n\n## Segments\n\nCloud grew." }],
      outline: [],
      warnings: [],
    };
    expect(markdownOf(parsed)).toBe("# Q3 memo\n\n## Segments\n\nCloud grew.");
  });

  it("labels the parts as soon as there is more than one to tell apart", () => {
    const parsed: ParsedAttachment = {
      version: 1,
      kind: "pdf",
      parts: [
        { type: "text", label: "Page 1", markdown: "First." },
        { type: "text", label: "Page 2", markdown: "Second." },
      ],
      outline: [],
      warnings: [],
    };
    expect(markdownOf(parsed)).toBe("## Page 1\n\nFirst.\n\n## Page 2\n\nSecond.");
  });

  it("counts a table that was cut short as truncated", () => {
    expect(describeParse(table(2_410)).truncated).toBe(true);
    expect(describeParse(table(3)).truncated).toBeUndefined();
  });

  it("carries the scanned pages the pdf parser reported, and leaves the field off when there are none", () => {
    const pdfParse = (scannedParts?: number[]): ParsedAttachment => ({
      version: 1,
      kind: "pdf",
      parts: [
        { type: "text", label: "Page 1", markdown: "A page with a real text layer, long enough to count as one." },
        { type: "text", label: "Page 2", markdown: "" },
      ],
      outline: [],
      warnings: [],
      ...(scannedParts ? { scannedParts } : {}),
    });
    expect(describeParse(pdfParse([2])).scannedParts).toEqual([2]);
    // Deriving them a second time is `pdf.ts`'s `scannedPages`, not this function's job: reaching
    // for it here would pull pdf.js into the request thread's bundle.
    expect(describeParse(pdfParse()).scannedParts).toBeUndefined();
  });
});
