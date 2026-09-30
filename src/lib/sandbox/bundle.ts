import { createHash, randomBytes } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { runtimeDir } from "@/lib/paths";
import type { BundleManifest } from "@/lib/sandbox/protocol";
import { errorMessage } from "@/lib/utils";

/**
 * Assembles the calculator runtime folder: one self-contained directory holding
 * Pyodide, the downloaded wheels, `fin` and the host, on a short path, with nothing sensitive
 * in it. Deno is given read access to this folder and to nothing else.
 *
 * Assembly needs no network. A folder is named for the versions and a digest of every source, and
 * appears in one rename, so it is either complete or absent and its runtime never changes once
 * placed: any number of processes may assemble at once, and none deletes a folder another is
 * running from. Folders of earlier versions are left where they are for the same reason.
 */

/** Packages loaded before the first job; the rest load on first import. */
const PRELOAD = ["numpy", "pandas"];

/**
 * The packages a user would recognise in the Settings status line, most familiar first.
 * Transitive dependencies are installed too and listed in the manifest, but naming them all
 * would make the status line unreadable.
 */
const HEADLINE_PACKAGES = ["numpy", "pandas", "scipy", "statsmodels"];

/** Pyodide core files the host needs; the rest of the npm package (maps, consoles) is left out. */
const PYODIDE_FILES = [
  "pyodide.mjs",
  "pyodide.asm.mjs",
  "pyodide.asm.wasm",
  "python_stdlib.zip",
  "pyodide-lock.json",
];

export interface BundleResult {
  status: "ready" | "missing";
  /** The assembled folder, the only path Deno may read; the runtime root when `missing`. */
  dir: string;
  manifest?: BundleManifest;
  /** Why the runtime could not be assembled. */
  message?: string;
}

interface SourceFile {
  /** Path inside the runtime folder, POSIX-separated. */
  target: string;
  source: string;
}

interface FetchedPackages {
  packages: { name: string; fileName: string }[];
}

/** The parts of Pyodide's lockfile the bundler reads: which module names each package provides. */
interface PyodideLock {
  packages?: Record<string, { imports?: string[] } | undefined>;
}

/** The project root; the sandbox sources and the downloaded wheels both live under it. */
function repoRoot(): string {
  return process.cwd();
}

function requireFromRepo(): NodeJS.Require {
  return createRequire(path.join(repoRoot(), "package.json"));
}

/** The installed `pyodide` package, wherever pnpm put it. */
function pyodidePackageDir(): string {
  return path.dirname(requireFromRepo().resolve(/* turbopackIgnore: true */ "pyodide/package.json"));
}

async function pyodideVersion(): Promise<string> {
  const manifest = JSON.parse(await readFile(path.join(pyodidePackageDir(), "package.json"), "utf8")) as {
    version?: string;
  };
  if (!manifest.version) throw new Error("node_modules/pyodide/package.json has no version");
  return manifest.version;
}

/** `fin.__version__`, read from the source so the runtime folder name changes when `fin` does. */
async function finVersion(): Promise<string> {
  const source = await readFile(path.join(repoRoot(), "sandbox", "fin", "__init__.py"), "utf8");
  const match = /^__version__\s*=\s*"([^"]+)"/m.exec(source);
  if (!match) throw new Error("sandbox/fin/__init__.py has no __version__");
  return match[1];
}

async function sha256(file: string): Promise<string> {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

/** Every Python file of the `fin` package, minus the tests and bytecode caches. */
async function finSources(dir: string, prefix: string): Promise<SourceFile[]> {
  const out: SourceFile[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "tests" || entry.name === "__pycache__") continue;
    const source = path.join(dir, entry.name);
    const target = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await finSources(source, target)));
    else if (entry.name.endsWith(".py")) out.push({ target, source });
  }
  return out;
}

/**
 * Everything that goes into the runtime folder, and where it comes from.
 * Throws with an actionable message when the downloaded packages are absent.
 */
async function collectSources(
  version: string,
): Promise<{ files: SourceFile[]; packages: string[]; importNames: string[] }> {
  const root = repoRoot();
  const sandboxSrc = path.join(root, "sandbox");
  const downloaded = path.join(root, ".sandbox", `pyodide-${version}`);

  let fetched: FetchedPackages;
  try {
    fetched = JSON.parse(await readFile(path.join(downloaded, "packages.json"), "utf8")) as FetchedPackages;
  } catch {
    throw new Error(
      `the calculator's Python packages are not downloaded — run \`pnpm sandbox:fetch\` (expected ${downloaded})`,
    );
  }

  const pyodideDir = pyodidePackageDir();
  const files: SourceFile[] = [
    { target: "host.ts", source: path.join(sandboxSrc, "host.ts") },
    // The host imports its wire types from beside itself; see the note at the top of protocol.ts.
    { target: "protocol.ts", source: path.join(root, "src", "lib", "sandbox", "protocol.ts") },
    { target: "python/runner.py", source: path.join(sandboxSrc, "runner.py") },
    { target: "python/precheck.py", source: path.join(sandboxSrc, "precheck.py") },
    { target: "python/selftest.py", source: path.join(sandboxSrc, "selftest.py") },
    // Runtime paths on the user's machine; the bundler must not trace them into the build.
    ...PYODIDE_FILES.map((name) => ({
      target: `pyodide/${name}`,
      source: path.join(/* turbopackIgnore: true */ pyodideDir, name),
    })),
    ...fetched.packages.map((pkg) => ({
      target: `pyodide/${pkg.fileName}`,
      source: path.join(downloaded, pkg.fileName),
    })),
    ...(await finSources(path.join(sandboxSrc, "fin"), "python/fin")),
  ];

  return { files, packages: fetched.packages.map((pkg) => pkg.name).sort(), importNames: await resolveImports(fetched) };
}

/** Pyodide's own lockfile: the authority on what each package it ships imports as. */
async function readPyodideLock(): Promise<NonNullable<PyodideLock["packages"]>> {
  const file = path.join(/* turbopackIgnore: true */ pyodidePackageDir(), "pyodide-lock.json");
  return (JSON.parse(await readFile(file, "utf8")) as PyodideLock).packages ?? {};
}

/**
 * What each installed package imports as, sorted.
 *
 * `fin` is in the list because it is bundled beside the wheels rather than installed as one.
 */
async function resolveImports(fetched: FetchedPackages): Promise<string[]> {
  const lock = await readPyodideLock();
  const importNames = new Set<string>(["fin"]);
  for (const pkg of fetched.packages) {
    for (const name of lock[pkg.name]?.imports ?? []) importNames.add(name);
  }
  return [...importNames].sort();
}

/** One digest over every source file, so a changed `fin` or a re-fetched wheel rebuilds the folder. */
async function digest(files: SourceFile[]): Promise<string> {
  const hash = createHash("sha256");
  for (const file of [...files].sort((a, b) => a.target.localeCompare(b.target))) {
    hash.update(`${file.target}:${await sha256(file.source)}\n`);
  }
  return hash.digest("hex");
}

async function readManifest(dir: string): Promise<BundleManifest | null> {
  try {
    return JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")) as BundleManifest;
  } catch {
    return null;
  }
}

/** A folder's name: both versions, then enough of the digest that a changed source is a new folder. */
function folderName(manifest: BundleManifest): string {
  return `calc-${manifest.pyodideVersion}-${manifest.finVersion}-${manifest.sourcesHash.slice(0, 8)}`;
}

/** How a staging folder is named beside its target, and how old one must be to count as abandoned. */
const STAGING_MARK = ".tmp-";
const ABANDONED_AFTER_MS = 60 * 60 * 1000;

/** Windows refuses a rename for a moment while a scanner holds a freshly written file. */
const TRANSIENT_RENAME = new Set(["EPERM", "EACCES", "EBUSY"]);
const RENAME_ATTEMPTS = 4;

function errorCode(err: unknown): string | undefined {
  return err instanceof Error && "code" in err && typeof err.code === "string" ? err.code : undefined;
}

/**
 * Staging folders a crashed assembly left behind. Assembly takes seconds, so one untouched for an
 * hour belongs to nobody; no process ever runs from a staging folder, only from a placed one.
 */
async function sweepAbandoned(root: string): Promise<void> {
  const cutoff = Date.now() - ABANDONED_AFTER_MS;
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || !entry.name.includes(STAGING_MARK)) continue;
    const staging = path.join(root, entry.name);
    const modified = await stat(staging).then((info) => info.mtimeMs, () => Date.now());
    if (modified < cutoff) await rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** The folder's manifest when it holds exactly this runtime; throws when it holds anything else. */
async function placed(dir: string, manifest: BundleManifest): Promise<BundleManifest | null> {
  const existing = await readManifest(dir);
  if (existing?.sourcesHash === manifest.sourcesHash) return existing;
  const present = await stat(dir).then(() => true, () => false);
  if (!present) return null;
  // Assembly only ever renames a finished folder into place, so this one was changed by hand or
  // cut short by a crash of the disk itself. It may still be in use, so it is not replaced here.
  throw new Error(`${dir} does not hold the runtime its name promises; delete it and try again`);
}

/**
 * Put the finished staging folder at `dir` in one rename. A folder, once placed, is never deleted
 * or rewritten: a process may be running Deno from it. When another assembler placed the same
 * runtime first, its folder stays and ours is discarded by the caller.
 */
async function placeStaging(staging: string, dir: string, manifest: BundleManifest): Promise<BundleManifest> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(staging, dir);
      return manifest;
    } catch (err) {
      const winner = await placed(dir, manifest);
      if (winner) return winner;
      const code = errorCode(err);
      if (attempt >= RENAME_ATTEMPTS || !code || !TRANSIENT_RENAME.has(code)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
    }
  }
}

/**
 * Assemble in a staging folder of our own, then rename it into place, so a half-copied folder is
 * never where the pool would boot from it, and two assemblers never write into the same folder.
 */
async function writeBundle(dir: string, files: SourceFile[], manifest: BundleManifest): Promise<BundleManifest> {
  const root = path.dirname(dir);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await sweepAbandoned(root);
  const staging = `${dir}${STAGING_MARK}${randomBytes(4).toString("hex")}`;
  try {
    for (const file of files) {
      const target = path.join(staging, ...file.target.split("/"));
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await copyFile(file.source, target);
    }
    await writeFile(path.join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return await placeStaging(staging, dir, manifest);
  } finally {
    // Gone already when the rename succeeded; ours alone to remove when it did not.
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Assemble the runtime folder for the pinned Pyodide and `fin` versions, reusing it when the
 * sources are unchanged. Returns `missing` when the packages need downloading; throws only when
 * the folder cannot be written or a folder of the same name holds something else.
 */
export async function ensureBundle(): Promise<BundleResult> {
  const version = await pyodideVersion();
  const fin = await finVersion();

  let sources: Awaited<ReturnType<typeof collectSources>>;
  try {
    sources = await collectSources(version);
  } catch (err) {
    return { status: "missing", dir: runtimeDir(), message: errorMessage(err) };
  }

  const manifest: BundleManifest = {
    pyodideVersion: version,
    finVersion: fin,
    packages: sources.packages,
    headline: HEADLINE_PACKAGES.filter((name) => sources.packages.includes(name)),
    importNames: sources.importNames,
    preload: PRELOAD,
    sourcesHash: await digest(sources.files),
  };

  const dir = path.join(runtimeDir(), folderName(manifest));
  const existing = await placed(dir, manifest);
  if (existing) return { status: "ready", dir, manifest: existing };
  return { status: "ready", dir, manifest: await writeBundle(dir, sources.files, manifest) };
}
