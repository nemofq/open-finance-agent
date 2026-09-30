import { builtinModules } from "node:module";
import { describe, expect, it } from "vitest";
import { PARSERS } from "@/lib/attachments/parse/registry";
import { type ImportEdge, ImportGraph } from "./import-graph";

/**
 * Dependency rules, checked on the import graph (`import-graph.ts`). Each failure prints the
 * import that breaks the rule and, where it is not direct, the chain of files that reaches it.
 */
const graph = new ImportGraph();
const imports = (file: string) => graph.module(file).imports;
const under = (dir: string) => (file: string | null) => file !== null && file.startsWith(`${dir}/`);

/** Imports that run when the importing module loads: not erased, not deferred to an `import()`. */
const loadTime = (edge: ImportEdge) => !edge.typeOnly && !edge.dynamic;

it("has no import cycles among modules that load one another", () => {
  // A lazy `import()` is how a real cycle is broken, so only load-time imports count.
  const cycles = graph.cycles(graph.files("src", "evals"), loadTime).map((cycle) => cycle.join(" → "));
  expect(cycles).toEqual([]);
});

it("has no barrels: every name is imported from the file that defines it", () => {
  const barrels = graph.files("src", "evals", "e2e", "scripts").filter((file) => graph.module(file).barrel);
  expect(barrels).toEqual([]);
});

it("keeps provider implementations out of core evidence", () => {
  const crossings = graph
    .files("src/lib/evidence")
    .flatMap((file) => imports(file).filter((edge) => under("src/lib/providers")(edge.target)).map((edge) => `${file} imports ${edge.specifier}`));
  expect([...new Set(crossings)]).toEqual([]);
});

it("keeps attachment handling and compaction independent", () => {
  const targets = (file: string) => imports(file).map((edge) => edge.target);
  expect(targets("src/lib/harness/attachments.ts").filter(under("src/lib/context"))).toEqual([]);
  expect(targets("src/lib/harness/compaction.ts").filter(under("src/lib/attachments"))).toEqual([]);
});

it("keeps delivery tool wiring out of the other harness concerns and the engines", () => {
  const files = ["agent", "policy", "context", "evidence", "harness", "providers"].flatMap((name) => graph.files(`src/lib/${name}`));
  for (const file of files.filter((f) => !f.includes("/delivery/"))) {
    expect(graph.source(file), file).not.toContain("create_report");
  }
});

it("imports pi wiring types only in the composer", () => {
  for (const file of graph.files("src/lib/harness").filter((f) => !f.endsWith("/concern.ts"))) {
    expect(graph.source(file), file).not.toMatch(/\b(?:AgentOptions|BeforeToolCallContext|AfterToolCallContext|AgentEvent)\b/);
  }
});

it("keeps document parsers behind the parse worker", () => {
  const parse = "src/lib/attachments/parse";
  const worker = `${parse}/worker.ts`;
  const registry = `${parse}/registry.ts`;
  // The parsers are what the PARSERS loaders import, so a format added there is covered here.
  const loaders = imports(registry).filter((edge) => edge.dynamic);
  expect(loaders, "every PARSERS loader is a plain import() of a sibling module").toHaveLength(Object.keys(PARSERS).length);
  const parsers = loaders.flatMap((edge) => edge.target ?? []);
  expect(parsers).toContain(`${parse}/pdf.ts`);
  // The worker's side of parse/: the worker, the registry it alone imports, and the parsers, which
  // may reuse a sibling (docx uses html). parse/index.ts and parse/sniff.ts run on the request thread.
  const workerSide = [worker, registry, ...parsers];
  const crossings: string[] = [];
  for (const file of graph.files("src")) {
    for (const { specifier, target } of imports(file)) {
      if (target === registry && file !== worker) crossings.push(`${file} imports ${specifier}: only the parse worker may`);
      if (target !== null && parsers.includes(target) && !workerSide.includes(file)) {
        crossings.push(`${file} imports ${specifier}: only the parse worker may load a parser, through parse/registry.ts`);
      }
    }
  }
  // Browser code may use the format table, never the readers behind it.
  for (const file of graph.files("src/components")) {
    for (const { specifier, target } of imports(file)) {
      if (under(parse)(target) || target === "src/lib/attachments/tables.ts") crossings.push(`${file} imports ${specifier}: a document reader`);
    }
  }
  expect(crossings).toEqual([]);
});

/* ------------------------------------------------------------ browser import boundaries */

/** Packages that parse documents, call data providers or hold server connections. */
const SERVER_PACKAGES = ["@modelcontextprotocol/sdk", "@tavily/core", "pdfjs-dist", "mammoth", "exceljs", "yahoo-finance2"];
/**
 * The composer renders the pages of a scanned PDF to images in the browser, since the server
 * never OCRs, so this one file may load pdfjs, and only lazily.
 */
const BROWSER_PDF_RENDERER = "src/components/chat/composer/prepare-pdf.ts";

const packageOf = (specifier: string) => specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/");

/**
 * Why an import must stay out of browser code, or `null` when a browser bundle may include it.
 * Stores, config and anything else that touches the disk are caught as reaching a Node built-in.
 */
function serverOnlyReason(from: string, edge: ImportEdge): string | null {
  if (edge.target === null) {
    if (edge.specifier.startsWith("node:") || builtinModules.includes(edge.specifier)) return "a Node built-in";
    const name = packageOf(edge.specifier);
    const lazyPdfRenderer = name === "pdfjs-dist" && from === BROWSER_PDF_RENDERER && edge.dynamic;
    return SERVER_PACKAGES.includes(name) && !lazyPdfRenderer ? `the ${name} package` : null;
  }
  if (edge.target === "src/lib/tools/registry.ts") return "the executable tool registry";
  const readsCredentials = imports(edge.target).some((inner) => inner.target === "src/lib/paths.ts" && inner.names.includes("authPath"));
  if (readsCredentials) return "a credentials reader";
  if (under("src/lib/attachments/parse")(edge.target)) return "a document parser";
  return null;
}

/**
 * What browser bundles are built from: the components, and the pages and layouts that are client
 * components. A server page may read a store; nothing it hands to the browser may.
 */
function browserEntries(): string[] {
  const clientApp = graph.files("src/app").filter((file) => !under("src/app/api")(file) && graph.module(file).directives.includes("use client"));
  return [...graph.files("src/components"), ...clientApp];
}

/** Every server-only import the entries reach through runtime imports, with the chain that reaches it. */
function browserLeaks(entries: string[]): string[] {
  const allowed = (edge: ImportEdge, from: string) => !edge.typeOnly && serverOnlyReason(from, edge) === null;
  return [...graph.reach(entries, allowed)].flatMap(([file, chain]) =>
    imports(file).flatMap((edge) => {
      const reason = edge.typeOnly ? null : serverOnlyReason(file, edge);
      return reason ? [`${chain.join(" → ")} imports ${edge.specifier}: ${reason}`] : [];
    }),
  );
}

describe("browser code", () => {
  it("never reaches Node built-ins, server packages, parsers, the tool registry or credential readers", () => {
    expect(browserLeaks(browserEntries())).toEqual([]);
  });

  it("is checked far enough to catch a server module behind a chain of imports", () => {
    // A server page is not a browser entry, which is what lets it read the session store.
    const page = "src/app/chat/[id]/page.tsx";
    expect(browserEntries()).not.toContain(page);
    expect(browserLeaks([page])).toContainEqual(expect.stringMatching(/^src\/app\/chat\/\[id\]\/page\.tsx → src\/lib\/sessions\/store\.ts imports node:\w+: a Node built-in$/));
    // The chat route reaches the registry only through the agent, several imports down.
    const route = "src/app/api/sessions/[id]/messages/route.ts";
    expect(browserLeaks([route])).toContainEqual(expect.stringMatching(/^src\/app\/api\/.* → .* → .*: the executable tool registry$/));
    expect(browserLeaks([route])).toContainEqual(expect.stringMatching(/: a credentials reader$/));
    expect(browserLeaks(["src/app/api/attachments/route.ts"])).toContainEqual(expect.stringMatching(/: a document parser$/));
  });
});

/* ------------------------------------------------------------ feature folders */

/** The feature folder a component lives in, or `null` outside `src/components/<feature>/`. */
const featureOf = (file: string) => /^src\/components\/([^/]+)\//.exec(file)?.[1] ?? null;
const COMMON = ["ui", "shared"];

/** A module that exports a hook or creates a React context is its feature's own business. */
function isPrivate(file: string): boolean {
  const { exports, calls } = graph.module(file);
  return exports.some((name) => /^use[A-Z]/.test(name)) || calls.includes("createContext");
}

it("lets a feature import ui/, shared/ and other features' components, not their hooks or context", () => {
  const crossings: string[] = [];
  for (const file of graph.files("src/components")) {
    const own = featureOf(file);
    for (const { specifier, target } of imports(file)) {
      const other = target === null ? null : featureOf(target);
      if (target === null || other === null || other === own || COMMON.includes(other)) continue;
      if (own !== null && COMMON.includes(own)) crossings.push(`${file} imports ${specifier}: ${own}/ must not depend on a feature`);
      else if (isPrivate(target)) crossings.push(`${file} imports ${specifier}: a hook or context private to ${other}/`);
    }
  }
  expect(crossings).toEqual([]);
});
