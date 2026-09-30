import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ImportGraph, parseModule } from "./import-graph";

const importsOf = (source: string, file = "a.ts") =>
  parseModule(file, source).imports.map(({ specifier, typeOnly, dynamic }) => ({ specifier, typeOnly, dynamic }));

describe("parseModule", () => {
  it("reads static, bare, re-exported and dynamic imports", () => {
    expect(
      importsOf(`
        import a from "./a";
        import "./side-effect";
        export { b } from "./b";
        export * from "./star";
        const c = () => import(/* turbopackIgnore: true */ "./c");
      `),
    ).toEqual([
      { specifier: "./a", typeOnly: false, dynamic: false },
      { specifier: "./side-effect", typeOnly: false, dynamic: false },
      { specifier: "./b", typeOnly: false, dynamic: false },
      { specifier: "./star", typeOnly: false, dynamic: false },
      { specifier: "./c", typeOnly: false, dynamic: true },
    ]);
  });

  it("marks what compiles away as type-only, and nothing else", () => {
    expect(
      importsOf(`
        import type { A } from "./a";
        import { type B, type C } from "./bc";
        import { type D, e } from "./de";
        import type from "./named-type";
        export type { F } from "./f";
        let g: import("./g").G;
      `).map(({ specifier, typeOnly }) => [specifier, typeOnly]),
    ).toEqual([
      ["./a", true],
      ["./bc", true],
      ["./de", false],
      ["./named-type", false],
      ["./f", true],
      ["./g", true],
    ]);
  });

  it("does not mistake an import in a comment or a string for one", () => {
    expect(importsOf(`// import x from "./commented";\nconst text = 'import y from "./quoted"';`)).toEqual([]);
  });

  it("reads exports, the directive prologue and the calls a module makes", () => {
    const parsed = parseModule(
      "hooks.tsx",
      `"use client";
      import { createContext } from "react";
      export const Ctx = createContext(null);
      export function useThing() {}
      function useLocal() {}
      export { useLocal as useRenamed };`,
    );
    expect(parsed.directives).toEqual(["use client"]);
    expect(parsed.exports).toEqual(expect.arrayContaining(["Ctx", "useThing", "useRenamed"]));
    expect(parsed.exports).not.toContain("useLocal");
    expect(parsed.calls).toContain("createContext");
  });

  it("tells a barrel, which only passes on what others define, from a module with code of its own", () => {
    const barrel = (source: string) => parseModule("a.ts", source).barrel;
    expect(barrel(`export * from "./a";\nexport type { B } from "./b";`)).toBe(true);
    expect(barrel(`"use client";\nimport { c } from "./c";\nexport { c };`)).toBe(true);
    expect(barrel(`export { a } from "./a";\nexport const b = 1;`)).toBe(false);
    expect(barrel(`import "./side-effect";`)).toBe(false);
    expect(barrel(`import x from "./x";\nexport default x;`)).toBe(true);
    expect(barrel(`export * from "./a";;`)).toBe(true);
    expect(barrel(`import "./side-effect";\nexport {};`)).toBe(false);
  });
});

describe("ImportGraph", () => {
  const root = mkdtempSync(path.join(tmpdir(), "import-graph-"));
  const write = (file: string, source: string) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), source);
  };
  write("src/a.ts", `import { b } from "@/b"; export const a = b;`);
  write("src/b.ts", `import { c } from "./lib"; export const b = c;`);
  write("src/lib/index.ts", `import type { A } from "../a"; export const c = 1; export type C = A;`);
  write("src/x.ts", `import { y } from "./y"; export const x = y;`);
  write("src/y.ts", `import { x } from "./x"; export const y = () => x;`);
  write("src/lazy.ts", `export const load = () => import("./x");`);
  write("src/a.test.ts", `import { a } from "./a";`);
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const graph = new ImportGraph(root);

  it("lists source files without tests and resolves @/, relative and index specifiers", () => {
    expect(graph.files("src")).toEqual(["src/a.ts", "src/b.ts", "src/lazy.ts", "src/lib/index.ts", "src/x.ts", "src/y.ts"]);
    expect(graph.module("src/a.ts").imports[0].target).toBe("src/b.ts");
    expect(graph.module("src/b.ts").imports[0].target).toBe("src/lib/index.ts");
  });

  it("reaches files with the shortest chain, along the edges it is told to follow", () => {
    const values = graph.reach(["src/a.ts"], (edge) => !edge.typeOnly);
    expect(values.get("src/lib/index.ts")).toEqual(["src/a.ts", "src/b.ts", "src/lib/index.ts"]);
    expect(graph.reach(["src/lazy.ts"], (edge) => !edge.dynamic).has("src/x.ts")).toBe(false);
  });

  it("finds each cycle once, and none through a type-only edge", () => {
    expect(graph.cycles(graph.files("src"), (edge) => !edge.typeOnly)).toEqual([["src/x.ts", "src/y.ts", "src/x.ts"]]);
    expect(graph.cycles(graph.files("src"), () => true)).toContainEqual(["src/a.ts", "src/b.ts", "src/lib/index.ts", "src/a.ts"]);
  });
});
