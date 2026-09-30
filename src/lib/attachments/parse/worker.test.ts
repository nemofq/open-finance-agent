/**
 * The worker boots from the source layout: `workerEntry()` finds `worker.ts`, every module it loads
 * resolves from `src/` the way its hooks resolve it, the build traces all of them, and a real file
 * of every format parses end to end through the real worker thread.
 *
 * Moving `worker.ts`, `registry.ts` or a parser without updating the others fails here rather than
 * in a production upload.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import nextConfig from "../../../../next.config";
import { supported } from "../formats";
import { docxOf } from "../testing";
import { buildPdf } from "./fixtures/pdf-documents";
import { buildPptx } from "./fixtures/pptx-decks";
import { markdownOf, parseAttachment, workerEntry } from "./index";
import { PARSERS } from "./registry";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
/** Where the worker's hooks point `@/`, and what `tsconfig.json` maps it to. */
const src = path.join(root, "src");
/** The suffixes the worker's resolver tries, in its order. */
const SUFFIXES = ["", ".ts", ".tsx", "/index.ts", ".js", "/index.js"];

/** Value imports only: `import type` is erased before Node runs the file, so it loads nothing. */
const STATIC_IMPORT = /^(?:import|export)\s+(?!type\s)[^;]*?\sfrom\s+["']([^"']+)["']/gm;
const DYNAMIC_IMPORT = /import\(\s*(?:\/\*.*?\*\/\s*)?["']([^"']+)["']\s*\)/g;

function resolveSource(from: string, specifier: string): string | undefined {
  const base = specifier.startsWith("@/") ? path.join(src, specifier.slice(2)) : path.resolve(path.dirname(from), specifier);
  return SUFFIXES.map((suffix) => base + suffix).find((candidate) => statSync(candidate, { throwIfNoEntry: false })?.isFile());
}

/** Every source file the worker can load, found by following its relative and `@/` imports. */
function workerSources(): { files: Set<string>; unresolved: string[] } {
  const files = new Set<string>();
  const unresolved: string[] = [];
  const visit = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of [...source.matchAll(STATIC_IMPORT), ...source.matchAll(DYNAMIC_IMPORT)]) {
      const specifier = match[1];
      if (!specifier.startsWith(".") && !specifier.startsWith("@/")) continue; // a package
      const target = resolveSource(file, specifier);
      if (target) visit(target);
      else unresolved.push(`${path.relative(root, file)} → ${specifier}`);
    }
  };
  visit(path.join(here, "worker.ts"));
  return { files, unresolved };
}

describe("the worker's source layout", () => {
  it("is started from the worker.ts beside this test", () => {
    if (process.env.OFA_PARSE_WORKER) return; // a deployment override, not the layout under test
    expect(workerEntry()).toBe(path.join(here, "worker.ts"));
  });

  it("loads the registry and every parser it names, and each import resolves from src/", () => {
    const { files, unresolved } = workerSources();
    expect(unresolved).toEqual([]);
    expect(files).toContain(path.join(here, "registry.ts"));
    for (const parser of Object.keys(PARSERS)) expect(files, parser).toContain(path.join(here, `${parser}.ts`));
  });

  it("stays inside attachments, which the build traces for the upload route", () => {
    const includes = nextConfig.outputFileTracingIncludes?.["/api/attachments"] ?? [];
    for (const file of workerSources().files) {
      const relative = path.relative(root, file).split(path.sep).join("/");
      expect(relative, "the worker reaches outside src/lib/attachments").toMatch(/^src\/lib\/attachments\//);
      expect(
        includes.some((glob) => path.matchesGlob(relative, glob.replace(/^\.\//, ""))),
        `${relative} is loaded by the parse worker but not traced for /api/attachments in next.config.ts`,
      ).toBe(true);
    }
  });

  it("traces no test, fixture or test helper for the upload route", () => {
    const includes = nextConfig.outputFileTracingIncludes?.["/api/attachments"] ?? [];
    const attachments = path.join(root, "src", "lib", "attachments");
    const testOnly = readdirSync(attachments, { recursive: true, encoding: "utf8" })
      .map((file) => `src/lib/attachments/${file.split(path.sep).join("/")}`)
      .filter((file) => /\.test\.tsx?$|\/testing\.ts$|\/fixtures\//.test(file));
    expect(testOnly.length).toBeGreaterThan(0);
    for (const file of testOnly) {
      expect(includes.some((glob) => path.matchesGlob(file, glob.replace(/^\.\//, ""))), file).toBe(false);
    }
  });
});

/* -------------------------------------------------- contract, real worker */

const utf8 = (text: string) => new TextEncoder().encode(text);

async function workbook(): Promise<Uint8Array> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Holdings");
  sheet.addRow(["Symbol", "Shares", "Bought"]);
  sheet.addRow(["AAPL", 12, new Date(Date.UTC(2024, 0, 31))]);
  return new Uint8Array(await book.xlsx.writeBuffer());
}

/** One real file per format, and a phrase its normalised Markdown must contain. */
const documents: [name: string, build: () => Uint8Array | Promise<Uint8Array>, expected: string][] = [
  ["memo.md", () => utf8("# Q3 memo\n\nRevenue rose 4%.\n"), "Revenue rose 4%"],
  ["page.html", () => utf8("<h1>Outlook</h1><p>Margins widened.</p>"), "Margins widened."],
  ["rows.csv", () => utf8("Symbol,Shares\nAAPL,12\n"), "| AAPL | 12 |"],
  ["book.xlsx", workbook, "| AAPL | 12 | 2024-01-31 |"],
  ["memo.docx", () => docxOf([{ heading: "Segments", paragraphs: ["Cloud grew 30%."] }]), "Cloud grew 30%."],
  ["deck.pptx", () => buildPptx({ slides: [{ title: "Plan", bullets: [{ text: "Cut costs" }] }] }), "Cut costs"],
  ["filing.pdf", () => buildPdf({ pages: [{ runs: [{ x: 72, y: 700, text: "Operating income rose across every reported segment." }] }] }), "Operating income rose"],
];

/**
 * `.doc` is the one parser without a case: no library in the tree can write a real Word 97 file
 * (see `legacy-doc.test.ts`), so it is covered by the load test in `index.test.ts` instead.
 */
const NO_REAL_FIXTURE = new Set(["legacy-doc"]);

describe("every format parses through the real worker", () => {
  it.each(documents)("%s", async (name, build, expected) => {
    const parsed = await parseAttachment(await build(), name);
    expect(parsed.parts.length).toBeGreaterThan(0);
    expect(markdownOf(parsed)).toContain(expected);
  });

  it("has a case for every parser in the registry", () => {
    const covered = new Set<string>([...documents.map(([name]) => supported(name)?.parser ?? name), ...NO_REAL_FIXTURE]);
    expect(covered).toEqual(new Set(Object.keys(PARSERS)));
  });
});
