/**
 * The job protocol between the calculator module (Node) and the sandbox host (Deno + Pyodide),
 * as JSON lines over stdin/stdout, and the manifest the bundler writes for the host to boot from.
 *
 * `sandbox/host.ts` imports its types from here. The bundler copies this file into the runtime
 * folder beside the host, which is where that import points once assembled; in the repository
 * `tsconfig.json`'s `rootDirs` lets the same import find it here. Keep it dependency-free.
 */

/** An evidence entry preloaded into the Python namespace as a pandas object named by its id. */
export interface SandboxEvidence {
  columns: string[];
  rows: (string | number | null)[][];
  /** Column to use as the index, when meaningful. */
  index?: string;
  meta: {
    id: string;
    summary?: string;
    source?: string;
    asOf?: string;
    unit?: string;
    currency?: string;
  };
}

export interface SandboxJob {
  type: "job";
  id: string;
  code: string;
  evidence: Record<string, SandboxEvidence>;
}

export interface SandboxEmitted {
  name: string;
  value: number | number[] | Record<string, number>;
  unit?: string;
  /** The formula string `fin` reports, when the value came from a `fin` function. */
  formula?: string;
}

export interface SandboxAssumption {
  name: string;
  value: number;
  why: string;
}

/** Numeric literal found in script outside `assume()` calls and common constants. */
export interface SandboxUndeclaredConstant {
  value: number;
  line: number;
  snippet: string;
}

export interface SandboxResult {
  type: "result";
  id: string;
  ok: boolean;
  emitted: SandboxEmitted[];
  assumptions: SandboxAssumption[];
  undeclaredConstants: SandboxUndeclaredConstant[];
  usedEvidence: string[];
  stdout: string;
  error?: string;
  durationMs: number;
  finVersion: string;
}

/** Sent once by the host when Pyodide and the preloaded packages are ready. */
export interface SandboxReady {
  type: "ready";
  pythonVersion: string;
  pyodideVersion: string;
  /** `fin.api_reference()`, so the tool description never names a function the runtime lacks. */
  finApi?: string;
}

export interface SandboxSelfTestRequest {
  type: "selftest";
  id: string;
  /** Absolute path of a canary file outside the runtime folder that must be unreadable. */
  canaryPath: string;
  /** Loopback port a listener waits on; any connection means the sandbox leaked. */
  canaryPort: number;
  /** The token inside the canary file; a probe that returns it has read the file. */
  canaryToken: string;
  /** Environment variable holding the same token, for the environment-read probes. */
  canaryEnv: string;
  /** Path a probe tries to create through a shell; the caller checks whether it appeared. */
  markerPath: string;
}

export interface SandboxSelfTestResult {
  type: "selftest_result";
  id: string;
  /** Every probe and whether it was blocked. */
  probes: { name: string; blocked: boolean; detail?: string }[];
}

export type SandboxRequest = SandboxJob | SandboxSelfTestRequest;
export type SandboxResponse = SandboxReady | SandboxResult | SandboxSelfTestResult | { type: "log"; message: string };

/** What Settings shows and what decides whether the calculator tool is registered. */
export interface SandboxStatus {
  state: "missing" | "ready" | "failed";
  pythonVersion?: string;
  pyodideVersion?: string;
  /** The recognisable few, for the Settings line. */
  packages?: string[];
  /**
   * Every module name the runtime can import, for the tool description: the model needs the whole
   * boundary, not the readable summary, or it spends a turn discovering that `ta` is not there.
   */
  importNames?: string[];
  isolation?: "passed" | "failed" | "untested";
  /** Human-readable explanation for `missing` and `failed`. */
  message?: string;
  /** `fin` version and API reference, for the tool description. */
  finVersion?: string;
  finApi?: string;
}

/** `manifest.json` in the runtime folder: what the bundler assembled, read by the host at boot. */
export interface BundleManifest {
  pyodideVersion: string;
  finVersion: string;
  /** Every Python package installed in the runtime, sorted. */
  packages: string[];
  /** The subset shown in Settings. */
  headline: string[];
  /**
   * Every top-level module name the runtime can import, sorted: the distribution names above say
   * what is installed, these say what the model types. The two differ often enough to matter
   * (`python-dateutil` imports as `dateutil`), so they are read from Pyodide's own lockfile
   * rather than guessed from the package name.
   */
  importNames: string[];
  preload: string[];
  /** Digest of every source file; its prefix names the folder, so changed sources are a new folder. */
  sourcesHash: string;
}
