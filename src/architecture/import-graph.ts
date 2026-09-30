/**
 * The repository's import graph, read with the TypeScript parser rather than matched with patterns,
 * for the dependency rules in `architecture.test.ts`. Test support: nothing in the app imports it.
 *
 * Paths are repository-relative with forward slashes on every OS, so a rule prints the same
 * dependency path everywhere. Only literal specifiers are seen; an `import()` of a computed string
 * is invisible here, as it is to the bundler.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

export interface ImportEdge {
  /** As written: `@/lib/paths`, `./render`, `node:fs`, `exceljs`. */
  specifier: string;
  /** The repository file it names, or `null` for a package or a Node built-in. */
  target: string | null;
  /** Erased when compiled: `import type`, all-`type` bindings, `export type … from`, `import("x").T`. */
  typeOnly: boolean;
  /** An `import()` call: the module loads when the call runs, not with the importer. */
  dynamic: boolean;
  /** What a static import or re-export takes by name, with `default` and `*`; empty otherwise. */
  names: string[];
}

export interface ModuleInfo {
  imports: ImportEdge[];
  /** Every name the module exports, re-exports by name included. */
  exports: string[];
  /** The directive prologue, such as `use client`. */
  directives: string[];
  /** Names of the functions and methods it calls, such as `createContext`. */
  calls: string[];
  /** Past its directives it only imports and exports, defining nothing: a barrel. */
  barrel: boolean;
}

/** An import as the parser reads it, before its specifier is resolved to a file. */
export type ParsedImport = Omit<ImportEdge, "target">;
export type ParsedModule = Omit<ModuleInfo, "imports"> & { imports: ParsedImport[] };

const CODE = /\.(?:tsx?|mts|mjs|js)$/;
const TEST = /\.test\.tsx?$/;
const RESOLVE_SUFFIXES = ["", ".ts", ".tsx", ".mts", ".mjs", ".js", ".json", "/index.ts", "/index.tsx"];

const isExported = (node: ts.Node) =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);

/** What one module imports, exports, declares at its top and calls, from its source text alone. */
export function parseModule(fileName: string, source: string): ParsedModule {
  const kind = fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const imports: ParsedImport[] = [];
  const exports = new Set<string>();
  const calls = new Set<string>();
  const directives: string[] = [];

  for (const statement of file.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
    directives.push(statement.expression.text);
  }
  // `export {}` only marks a file as a module; `export default x` passes an import on.
  const passesOn = (statement: ts.Statement) => ts.isExportDeclaration(statement)
    ? statement.moduleSpecifier !== undefined || (statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause) && statement.exportClause.elements.length > 0)
    : ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression);
  const body = file.statements.slice(directives.length).filter((statement) => !ts.isEmptyStatement(statement));
  const barrel = body.some(passesOn) && body.every((statement) => passesOn(statement) || ts.isImportDeclaration(statement));
  for (const statement of file.statements) {
    if (!isExported(statement)) continue;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) exports.add(declaration.name.text);
      }
    } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) {
      exports.add(statement.name.text);
    } else if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) {
      exports.add(statement.name.text);
    }
  }

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const named = bindings && ts.isNamedImports(bindings) ? bindings.elements : undefined;
      const names = [
        ...(clause?.name ? ["default"] : []),
        ...(bindings && ts.isNamespaceImport(bindings) ? ["*"] : []),
        ...(named ?? []).map((element) => (element.propertyName ?? element.name).text),
      ];
      const allTypes = !clause?.name && named !== undefined && named.length > 0 && named.every((element) => element.isTypeOnly);
      const typeOnly = clause?.phaseModifier === ts.SyntaxKind.TypeKeyword || allTypes;
      imports.push({ specifier: node.moduleSpecifier.text, typeOnly, dynamic: false, names });
    } else if (ts.isExportDeclaration(node)) {
      const clause = node.exportClause;
      const named = clause && ts.isNamedExports(clause) ? clause.elements : undefined;
      for (const element of named ?? []) exports.add(element.name.text);
      if (clause && ts.isNamespaceExport(clause)) exports.add(clause.name.text);
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const allTypes = named !== undefined && named.length > 0 && named.every((element) => element.isTypeOnly);
        const names = named ? named.map((element) => (element.propertyName ?? element.name).text) : ["*"];
        imports.push({ specifier: node.moduleSpecifier.text, typeOnly: node.isTypeOnly || allTypes, dynamic: false, names });
      }
    } else if (ts.isExportAssignment(node)) {
      exports.add("default");
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      imports.push({ specifier: node.moduleReference.expression.text, typeOnly: node.isTypeOnly, dynamic: false, names: ["*"] });
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      imports.push({ specifier: node.argument.literal.text, typeOnly: true, dynamic: false, names: [] });
    } else if (ts.isCallExpression(node)) {
      const [argument] = node.arguments;
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        if (argument && ts.isStringLiteralLike(argument)) imports.push({ specifier: argument.text, typeOnly: false, dynamic: true, names: [] });
      } else if (ts.isIdentifier(node.expression)) {
        calls.add(node.expression.text);
      } else if (ts.isPropertyAccessExpression(node.expression)) {
        calls.add(node.expression.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { imports, exports: [...exports], directives, calls: [...calls], barrel };
}

export class ImportGraph {
  private readonly modules = new Map<string, ModuleInfo>();

  /** `root` is the repository root, which vitest runs from. */
  constructor(private readonly root: string = process.cwd()) {}

  /** Every source file under the given folders, tests excluded, sorted. */
  files(...dirs: string[]): string[] {
    const walk = (dir: string): string[] =>
      readdirSync(path.join(this.root, dir), { withFileTypes: true }).flatMap((entry) => {
        const file = `${dir}/${entry.name}`;
        if (entry.isDirectory()) return entry.name === "node_modules" || entry.name.startsWith(".") ? [] : walk(file);
        return CODE.test(file) && !TEST.test(file) && !file.endsWith(".d.ts") ? [file] : [];
      });
    return dirs.flatMap(walk).sort();
  }

  source(file: string): string {
    return readFileSync(path.join(this.root, file), "utf8");
  }

  /** The module's imports, resolved to files, and what it exports; a non-code file has none. */
  module(file: string): ModuleInfo {
    const known = this.modules.get(file);
    if (known) return known;
    const parsed: ParsedModule = CODE.test(file)
      ? parseModule(file, this.source(file))
      : { imports: [], exports: [], directives: [], calls: [], barrel: false };
    const info: ModuleInfo = { ...parsed, imports: parsed.imports.map((edge) => ({ ...edge, target: this.resolve(file, edge.specifier) })) };
    this.modules.set(file, info);
    return info;
  }

  /**
   * Every file the entries reach along the edges `follow` accepts, each with the shortest chain
   * of files that reaches it, entry first and the file itself last.
   */
  reach(entries: string[], follow: (edge: ImportEdge, from: string) => boolean): Map<string, string[]> {
    const chains = new Map<string, string[]>(entries.map((entry) => [entry, [entry]]));
    const queue = [...chains.keys()];
    for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
      const chain = chains.get(file) ?? [file];
      for (const edge of this.module(file).imports) {
        if (edge.target === null || chains.has(edge.target) || !follow(edge, file)) continue;
        chains.set(edge.target, [...chain, edge.target]);
        queue.push(edge.target);
      }
    }
    return chains;
  }

  /**
   * The import cycles among `files` along the edges `follow` accepts: one closed chain
   * (`a → b → a`) per strongly connected group, through the group's first file.
   */
  cycles(files: string[], follow: (edge: ImportEdge, from: string) => boolean): string[][] {
    const inScope = new Set(files);
    const next = (file: string) =>
      this.module(file).imports.flatMap((edge) => (edge.target !== null && inScope.has(edge.target) && follow(edge, file) ? [edge.target] : []));

    // Tarjan's algorithm: `low` is the earliest file still on the stack that `file` can reach.
    const index = new Map<string, number>();
    const low = new Map<string, number>();
    const stack: string[] = [];
    const onStack = new Set<string>();
    const groups: string[][] = [];
    const connect = (file: string): void => {
      const order = index.size;
      index.set(file, order);
      low.set(file, order);
      stack.push(file);
      onStack.add(file);
      for (const target of next(file)) {
        if (!index.has(target)) connect(target);
        if (onStack.has(target)) low.set(file, Math.min(low.get(file) ?? 0, low.get(target) ?? 0, index.get(target) ?? 0));
      }
      if (low.get(file) !== index.get(file)) return;
      const group: string[] = [];
      for (let member = stack.pop(); member !== undefined; member = stack.pop()) {
        onStack.delete(member);
        group.push(member);
        if (member === file) break;
      }
      if (group.length > 1 || next(file).includes(file)) groups.push(group.sort());
    };
    for (const file of [...inScope].sort()) if (!index.has(file)) connect(file);

    return groups.map((group) => {
      const members = new Set(group);
      const start = group[0];
      const cycle = this.reach([start], (edge, from) => members.has(from) && edge.target !== null && members.has(edge.target) && follow(edge, from));
      // The shortest way back to the start from any file one step away from closing the loop.
      const closing = [...cycle.values()]
        .filter((chain) => next(chain[chain.length - 1]).includes(start))
        .sort((a, b) => a.length - b.length)[0];
      return [...(closing ?? [start]), start];
    });
  }

  /** The file `specifier` names from `from`: `@/` is `src/`, a relative path is resolved; a package is `null`. */
  private resolve(from: string, specifier: string): string | null {
    const base = specifier.startsWith("@/")
      ? `src/${specifier.slice(2)}`
      : specifier.startsWith(".")
        ? path.posix.join(path.posix.dirname(from), specifier)
        : null;
    if (base === null) return null;
    const candidates = [...RESOLVE_SUFFIXES.map((suffix) => base + suffix), base.replace(/\.js$/, ".ts")];
    const found = candidates.find((candidate) => {
      try {
        return statSync(path.join(this.root, candidate)).isFile();
      } catch {
        return false;
      }
    });
    if (found === undefined) throw new Error(`${from}: cannot resolve ${specifier}`);
    return found;
  }
}
