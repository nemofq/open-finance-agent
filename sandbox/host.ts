/**
 * Calculator sandbox host: boots Pyodide inside Deno and processes execution requests.
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
// The bundler copies `src/lib/sandbox/protocol.ts` beside this file, and `tsconfig.json`'s
// `rootDirs` resolves the same path in the repository. Types only: erased before Deno runs this.
import type {
  BundleManifest,
  SandboxJob,
  SandboxRequest,
  SandboxResponse,
  SandboxResult,
  SandboxSelfTestRequest,
  SandboxSelfTestResult,
} from "./protocol.ts";

/* ------------------------------------------------------------------- wire shapes */

/** What `runner.run_job` returns, before the id and type are added. */
type JobOutcome = Omit<SandboxResult, "type" | "id" | "error"> & { error: string | null };

/* ------------------------------------------------------------------------ output */

function send(message: SandboxResponse): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function log(message: string): void {
  send({ type: "log", message });
}

/* ------------------------------------------------------------------------- boot */

const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const pyodideDir = path.join(runtimeDir, "pyodide");
/** Where the bundler put `fin/` and the runner, pre-check and self-test, all read into the sandbox FS. */
const pythonDir = path.join(runtimeDir, "python");
/** A directory inside Pyodide's in-memory filesystem; the host folder is never mounted. */
const sandboxPath = "/sandbox";

// Loaded dynamically so this file needs no build step and no module resolution in the repository.
async function loadPyodideModule(): Promise<{ loadPyodide: (config: object) => Promise<PyodideApi> }> {
  const entry = pathToFileURL(path.join(pyodideDir, "pyodide.mjs")).href;
  return (await import(entry)) as { loadPyodide: (config: object) => Promise<PyodideApi> };
}

/** Only the parts of Pyodide's API the host touches. */
interface PyodideApi {
  version: string;
  FS: { mkdirTree(dir: string): void; writeFile(file: string, data: string, options: { encoding: string }): void };
  runPython(code: string): unknown;
  runPythonAsync(code: string): Promise<unknown>;
  globals: { set(name: string, value: unknown): void; delete(name: string): void };
  pyimport(name: string): Record<string, (...args: never[]) => string>;
  loadPackage(names: string[]): Promise<unknown>;
  loadPackagesFromImports(code: string): Promise<unknown>;
}

/** Copy the Python sources into Pyodide's in-memory filesystem, preserving the folder layout. */
async function installPython(pyodide: PyodideApi, from: string, to: string): Promise<void> {
  pyodide.FS.mkdirTree(to);
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = `${to}/${entry.name}`;
    if (entry.isDirectory()) {
      await installPython(pyodide, source, target);
    } else if (entry.name.endsWith(".py")) {
      pyodide.FS.writeFile(target, await readFile(source, "utf8"), { encoding: "utf8" });
    }
  }
}

async function boot(): Promise<{ pyodide: PyodideApi; manifest: BundleManifest }> {
  const manifest = JSON.parse(await readFile(path.join(runtimeDir, "manifest.json"), "utf8")) as BundleManifest;
  const { loadPyodide } = await loadPyodideModule();
  const pyodide = await loadPyodide({
    indexURL: `${pyodideDir}${path.sep}`,
    // Packages resolve next to the lockfile in the runtime folder, so nothing reaches the CDN.
    packageCacheDir: `${pyodideDir}${path.sep}`,
    // Belt and braces on top of Deno's permissions: the `js` module sees an empty object and
    // `os.environ` starts empty. Neither is load-bearing; the escape probes test the real boundary.
    jsglobals: Object.create(null),
    env: {},
    // Pyodide's own diagnostics must not corrupt the JSON-lines stream on stdout.
    stdout: (message: string) => log(message),
    stderr: (message: string) => log(message),
  });

  await installPython(pyodide, pythonDir, sandboxPath);
  pyodide.runPython(`import sys; sys.path.insert(0, ${JSON.stringify(sandboxPath)})`);
  await pyodide.loadPackage(manifest.preload);
  return { pyodide, manifest };
}

/* -------------------------------------------------------------------------- jobs */

async function runJob(pyodide: PyodideApi, manifest: BundleManifest, request: SandboxJob): Promise<void> {
  const runner = pyodide.pyimport("runner");
  const importNames = JSON.stringify(manifest.importNames);
  // The pre-check only parses, so asking it first runs none of the model's code. Code it rejects
  // never gets its packages loaded: pulling scipy off disk for a job that will not run is the
  // slowest way to answer a one-line complaint. `run_job` re-runs the check and reports it.
  const rejected = String(runner.precheck_message(request.code as never, importNames as never));
  if (!rejected) {
    // scipy and statsmodels are large, so they load on first use rather than at boot. A package the
    // code imports but the runtime does not have simply fails here, and Python raises ImportError.
    try {
      await pyodide.loadPackagesFromImports(request.code);
    } catch (err) {
      log(`package preload skipped: ${describe(err)}`);
    }
  }

  const payload = JSON.stringify({ evidence: request.evidence, importNames: manifest.importNames });
  const outcome = JSON.parse(runner.run_job(request.code as never, payload as never)) as JobOutcome;
  send({ type: "result", id: request.id, ...outcome, error: outcome.error ?? undefined });
}

/* --------------------------------------------------------------------- self-test */

async function runSelfTest(pyodide: PyodideApi, request: SandboxSelfTestRequest): Promise<void> {
  // The probes are awaited in Python: a JavaScript fetch hands back a pending promise and only
  // rejects once Deno's permission check has run, so a synchronous probe would see success.
  pyodide.globals.set("_selftest_args", JSON.stringify(request));
  const probes = JSON.parse(
    String(await pyodide.runPythonAsync("import selftest; await selftest.run_probes(_selftest_args)")),
  ) as SandboxSelfTestResult["probes"];
  pyodide.globals.delete("_selftest_args");
  const selftest = pyodide.pyimport("selftest");

  // Sent before `os.system`, which can take the interpreter down with it; the parent decides that
  // probe's verdict from whether the marker file appeared.
  send({ type: "selftest_result", id: request.id, probes });

  try {
    log(`os_system ${selftest.run_os_system(request.markerPath as never)}`);
  } catch (err) {
    log(`os_system raised ${describe(err)}`);
  }
}

/* -------------------------------------------------------------------- job loop */

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function main(): Promise<void> {
  const { pyodide, manifest } = await boot();
  const pythonVersion = String(pyodide.runPython("import sys; sys.version.split()[0]"));
  // The API reference comes from `fin`'s own registry, so the tool description can never promise
  // a function the installed version does not have.
  const finApi = String(pyodide.runPython("import fin; fin.api_reference()"));
  send({ type: "ready", pythonVersion, pyodideVersion: pyodide.version, finApi });

  // One job at a time: the next line is not read until this one is answered.
  let fatal = false;
  const lines = createInterface({ input: process.stdin });
  for await (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let request: SandboxRequest;
    try {
      request = JSON.parse(trimmed) as SandboxRequest;
    } catch {
      log(`ignored a malformed request line of ${trimmed.length} characters`);
      continue;
    }
    try {
      if (request.type === "job") await runJob(pyodide, manifest, request);
      else await runSelfTest(pyodide, request);
    } catch (err) {
      // A failure out here is the host's, not the model's: `run_job` turns anything the model
      // raises into an `ok: false` result, so reaching this means Pyodide itself threw. That
      // usually means the interpreter is gone (`os.system` does exactly this), and a dead
      // interpreter answers every later job with nothing at all — so report the error against
      // this request and then let the process end, which makes the pool boot a fresh one.
      fatal = true;
      send({
        type: "result",
        id: request.id,
        ok: false,
        emitted: [],
        assumptions: [],
        undeclaredConstants: [],
        usedEvidence: [],
        stdout: "",
        error: `sandbox host: ${describe(err)}`,
        durationMs: 0,
        finVersion: "",
      });
      break;
    }
  }
  lines.close();
  process.exitCode = fatal ? 1 : 0;
}

main().catch((err: unknown) => {
  log(`sandbox host failed to start: ${describe(err)}`);
  process.exit(1);
});
