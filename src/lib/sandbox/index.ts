import { randomUUID } from "node:crypto";
import { ensureBundle } from "@/lib/sandbox/bundle";
import { SandboxPool } from "@/lib/sandbox/pool";
import type { SandboxJob, SandboxResult, SandboxStatus } from "@/lib/sandbox/protocol";
import { describeFailure, readVerdict, runSelfTest, type SelfTestVerdict } from "@/lib/sandbox/selftest";
import { processSingleton } from "@/lib/process-state";
import { errorMessage } from "@/lib/utils";

/**
 * The calculator sandbox as the rest of the app sees it.
 *
 * One runtime per server process: assembled once, isolation-checked once per version, then kept
 * warm. Everything here fails closed — until the escape probes have all passed,
 * `isSandboxAvailable()` is false and the calculator tool is never registered.
 */

interface SandboxState {
  pool: SandboxPool | null;
  status: SandboxStatus;
  starting: Promise<SandboxStatus> | null;
}

/**
 * One per process: instrumentation warms the sandbox from its own copy of this module, and the
 * route that runs a calculation must find the runtime it started rather than a copy that never did.
 */
function sandbox(): SandboxState {
  return processSingleton<SandboxState>("sandbox.runtime", () => ({
    pool: null,
    status: { state: "missing", isolation: "untested" },
    starting: null,
  }));
}

type CalculationJob = Omit<SandboxJob, "type" | "id"> & { timeoutMs: number };

/** The last known status, without starting anything. Safe to call from a render or a prompt. */
export function getSandboxStatus(): SandboxStatus {
  return { ...sandbox().status };
}

/** Ready and proven isolated: the only condition under which the calculator tool is registered. */
export function isSandboxAvailable(): boolean {
  const { status } = sandbox();
  return status.state === "ready" && status.isolation === "passed";
}

/**
 * Assemble the runtime, check its isolation, and boot it. Safe to call repeatedly: after the
 * first success it returns the cached status without touching the process.
 *
 * @param options.recheck re-run the escape probes even when this version already passed
 *   (Settings' Validate button).
 */
export function ensureSandbox(options: { recheck?: boolean } = {}): Promise<SandboxStatus> {
  const state = sandbox();
  if (!options.recheck && isSandboxAvailable() && state.pool) return Promise.resolve(getSandboxStatus());
  state.starting ??= start(options).finally(() => {
    state.starting = null;
  });
  return state.starting;
}

async function start(options: { recheck?: boolean }): Promise<SandboxStatus> {
  // Stop first: a recheck is meant to give the user a genuinely fresh runtime, and the probes
  // need it to themselves.
  shutdownSandbox();
  const state = sandbox();

  let bundle: Awaited<ReturnType<typeof ensureBundle>>;
  try {
    bundle = await ensureBundle();
  } catch (err) {
    state.status = {
      state: "failed",
      isolation: "untested",
      message: `the calculator runtime could not be assembled: ${errorMessage(err)}`,
    };
    return getSandboxStatus();
  }
  const { dir, manifest } = bundle;
  if (bundle.status === "missing" || !manifest) {
    state.status = { state: "missing", isolation: "untested", message: bundle.message };
    return getSandboxStatus();
  }

  const stored = options.recheck ? null : await readVerdict(dir, manifest);
  let verdict: SelfTestVerdict;
  try {
    // The probes need the runtime to themselves, so they run before the warm pool exists.
    verdict = stored ?? (await runSelfTest(dir, manifest));
  } catch (err) {
    state.status = {
      state: "failed",
      isolation: "failed",
      message: `the calculator sandbox could not be checked: ${errorMessage(err)}`,
    };
    return getSandboxStatus();
  }

  if (!verdict.passed) {
    state.status = { state: "failed", isolation: "failed", message: describeFailure(verdict) };
    return getSandboxStatus();
  }

  const pool = new SandboxPool({ dir, manifest });
  state.pool = pool;

  try {
    await pool.start();
  } catch (err) {
    state.status = {
      state: "failed",
      isolation: "passed",
      message: `the calculator sandbox failed to start: ${errorMessage(err)}`,
    };
    return getSandboxStatus();
  }

  const pooled = pool.status();
  state.status = {
    state: "ready",
    isolation: "passed",
    pythonVersion: pooled.pythonVersion,
    pyodideVersion: pooled.pyodideVersion,
    packages: manifest.headline,
    importNames: manifest.importNames,
    finVersion: manifest.finVersion,
    finApi: pooled.finApi,
  };
  return getSandboxStatus();
}

/**
 * Start the sandbox process in the background, so a calculation later in the turn does not pay
 * for the boot. Never throws and never waits.
 *
 * Called when a chat turn begins. The pool gives its ~700 MB back after fifteen idle minutes and
 * the process is killed after a timeout or a crash, while the status this module publishes stays
 * `ready` — which is correct, because the runtime is fine and the pool boots a fresh process on
 * the next job. The cost is that the boot then happens inside the model's tool call, several
 * seconds it spends waiting; warming here moves it to while the model is still reading.
 *
 * A runtime that has never booted or failed its isolation check is left alone: that is
 * `ensureSandbox`'s business, and retrying it here would spawn a doomed process on every turn.
 */
export function warmSandbox(): void {
  const { pool } = sandbox();
  if (!pool || !isSandboxAvailable()) return;
  if (pool.status().state === "failed") return;
  pool.warm();
}

/** Run one calculation. Throws when the sandbox is unavailable, times out, or the process dies. */
export async function runCalculation(job: CalculationJob): Promise<SandboxResult> {
  const { pool } = sandbox();
  if (!pool) throw new Error("the calculator sandbox is not running");
  // An idle pool has no process; `runJob` boots one before it sends, so the job waits rather
  // than failing. That is the path a calculation takes after the fifteen-minute shutdown when
  // nothing warmed the pool first.
  const { timeoutMs, ...request } = job;
  return pool.runJob({ id: randomUUID(), ...request }, timeoutMs);
}

/** Stop the sandbox process. The next calculation starts a fresh one. */
export function shutdownSandbox(): void {
  const state = sandbox();
  state.pool?.shutdown();
  state.pool = null;
}
