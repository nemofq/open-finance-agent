import { SandboxProcess } from "@/lib/sandbox/process";
import type {
  BundleManifest,
  SandboxJob,
  SandboxResponse,
  SandboxResult,
  SandboxSelfTestRequest,
  SandboxSelfTestResult,
} from "@/lib/sandbox/protocol";
import { errorMessage } from "@/lib/utils";

/**
 * One warm sandbox process, one job at a time.
 *
 * pi runs tool calls in parallel, so jobs queue rather than share the interpreter. A job that
 * overruns its timeout, or code that takes the interpreter down (`os.system` does), kills the
 * process; the next job starts a fresh one.
 */

/** Recycled after this many jobs, so a slow leak inside Pyodide never grows without bound. */
const MAX_JOBS = 200;

/** The warm process costs about 700 MB, so an unused calculator gives it back. */
const IDLE_SHUTDOWN_MS = 15 * 60 * 1000;

/** Booting Pyodide and preloading numpy and pandas takes a few seconds; two minutes is a hang. */
const BOOT_TIMEOUT_MS = 120_000;

/** The escape probes include a 4 GiB allocation, which is slow to fail. */
const SELFTEST_TIMEOUT_MS = 120_000;

export type PoolState = "idle" | "starting" | "ready" | "failed";

export interface PoolStatus {
  state: PoolState;
  pythonVersion?: string;
  pyodideVersion?: string;
  /** `fin.api_reference()` as the host reported it; undefined until the first boot. */
  finApi?: string;
}

export interface PoolOptions {
  dir: string;
  manifest: BundleManifest;
  /** Extra environment for the sandbox process; the self-test uses it to plant a canary. */
  env?: Record<string, string>;
}

/** The process died before answering: the job never ran, so it is safe to run it again. */
class SandboxCrashError extends Error {}

interface Pending {
  id: string;
  resolve: (response: SandboxResult | SandboxSelfTestResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class SandboxPool {
  private process: SandboxProcess | null = null;
  private booting: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private pending: Pending | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  /** Settles the boot that is in flight, so stopping the pool never orphans it. */
  private abortBoot: ((error?: Error) => void) | null = null;

  /** Bumped whenever the process is replaced, so a dead one's events cannot touch live state. */
  private generation = 0;

  private state: PoolState = "idle";
  private pythonVersion: string | undefined;
  private pyodideVersion: string | undefined;
  private finApi: string | undefined;
  private jobsRun = 0;

  /** The last line the current process logged, which usually says why a boot failed. */
  private lastLog: string | undefined;

  constructor(private readonly options: PoolOptions) {}

  status(): PoolStatus {
    return {
      state: this.state,
      pythonVersion: this.pythonVersion,
      pyodideVersion: this.pyodideVersion ?? this.options.manifest.pyodideVersion,
      finApi: this.finApi,
    };
  }

  /**
   * Boot, so the first calculation does not pay for it. Rejects when the sandbox cannot start,
   * with the host's last log line appended for Settings; a job's own error never carries it.
   */
  async start(): Promise<void> {
    try {
      await this.ensureProcess();
    } catch (err) {
      throw new Error(this.lastLog ? `${errorMessage(err)}; last host output: ${this.lastLog}` : errorMessage(err));
    }
  }

  /** Boot in the background. Never throws. */
  warm(): void {
    void this.ensureProcess().catch(() => undefined);
  }

  async runJob(job: Omit<SandboxJob, "type">, timeoutMs: number): Promise<SandboxResult> {
    const response = await this.submit({ ...job, type: "job" }, timeoutMs);
    if (response.type !== "result") throw new Error("the sandbox answered a job with the wrong message");
    return response;
  }

  /** Run the escape probes, returning the host's verdict. */
  async runSelfTest(request: Omit<SandboxSelfTestRequest, "type">): Promise<SandboxSelfTestResult> {
    const response = await this.submit({ ...request, type: "selftest" }, SELFTEST_TIMEOUT_MS);
    if (response.type !== "selftest_result") throw new Error("the sandbox answered the self-test with the wrong message");
    // `os.system` runs after the verdict is on the wire and may kill the interpreter, so give it a
    // moment to create its marker before the caller looks for it.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    return response;
  }

  /** Stop the process. It starts again on the next job. */
  shutdown(reason = "shut down"): void {
    this.clearIdleTimer();
    this.generation += 1;
    // A boot in flight belongs to the generation being retired: settle it here, or whoever is
    // awaiting it waits out the boot timeout and its stale timer later fails a healthy pool.
    this.abortBoot?.(new Error(`the calculator sandbox was stopped while starting (${reason})`));
    this.abortBoot = null;
    this.process?.kill();
    this.process = null;
    this.booting = null;
    if (this.state !== "failed") this.state = "idle";
  }

  /* ------------------------------------------------------------------ internals */

  private submit(
    request: SandboxJob | SandboxSelfTestRequest,
    timeoutMs: number,
  ): Promise<SandboxResult | SandboxSelfTestResult> {
    // Serialize on the queue so a second tool call waits instead of interleaving.
    const run = this.queue.then(() => this.dispatch(request, timeoutMs));
    this.queue = run.catch(() => undefined);
    return run;
  }

  /**
   * A crash gets exactly one retry. The interpreter can die on the job *before* this one (that is
   * what `os.system` does), and the exit has not been observed yet when this job is sent, so the
   * first attempt fails through no fault of the code. A job that crashes the interpreter itself
   * is answered by the host before the process goes, so it is not retried.
   */
  private async dispatch(
    request: SandboxJob | SandboxSelfTestRequest,
    timeoutMs: number,
  ): Promise<SandboxResult | SandboxSelfTestResult> {
    try {
      return await this.attempt(request, timeoutMs);
    } catch (err) {
      if (!(err instanceof SandboxCrashError)) throw err;
      this.shutdown("restarting after a crash");
      return this.attempt(request, timeoutMs);
    }
  }

  private async attempt(
    request: SandboxJob | SandboxSelfTestRequest,
    timeoutMs: number,
  ): Promise<SandboxResult | SandboxSelfTestResult> {
    this.clearIdleTimer();
    if (this.jobsRun >= MAX_JOBS) {
      this.jobsRun = 0;
      this.shutdown("recycled after 200 jobs");
    }
    await this.ensureProcess();

    const outcome = await new Promise<SandboxResult | SandboxSelfTestResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        // The interpreter is mid-calculation and cannot be interrupted from here, so the process
        // goes and the next job gets a fresh one.
        this.shutdown("killed after a timeout");
        reject(new Error(`the calculation did not finish within ${Math.round(timeoutMs / 1000)}s and was stopped`));
      }, timeoutMs);
      this.pending = { id: request.id, resolve, reject, timer };
      try {
        if (!this.process) throw new Error("the calculator sandbox is not running");
        this.process.send(request);
      } catch (err) {
        clearTimeout(timer);
        this.pending = null;
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });

    this.jobsRun += 1;
    this.startIdleTimer();
    return outcome;
  }

  private ensureProcess(): Promise<void> {
    if (this.process?.alive && this.state === "ready") return Promise.resolve();
    this.booting ??= this.boot().finally(() => {
      this.booting = null;
    });
    return this.booting;
  }

  private boot(): Promise<void> {
    this.state = "starting";
    this.lastLog = undefined;
    // Everything below belongs to one generation: a process killed on timeout keeps emitting
    // events after its replacement exists, and those must be ignored rather than applied.
    const generation = (this.generation += 1);
    const current = (): boolean => this.generation === generation;
    return new Promise<void>((resolve, reject) => {
      // Exactly one settlement per boot, whether it becomes ready, dies, times out, or the pool
      // is stopped underneath it. `timer` is only read once `finish` is actually called, which
      // cannot happen before the timer exists.
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.abortBoot === finish) this.abortBoot = null;
        if (error) reject(error);
        else resolve();
      };
      const timer = setTimeout(() => {
        if (!current()) return;
        const reason = `the sandbox did not become ready within ${BOOT_TIMEOUT_MS / 1000}s`;
        this.fail();
        finish(new Error(reason));
      }, BOOT_TIMEOUT_MS);
      this.abortBoot = finish;

      const process = new SandboxProcess(
        this.options.dir,
        {
          onResponse: (message) => {
            if (!current()) return;
            if (message.type === "ready") {
              this.state = "ready";
              this.pythonVersion = message.pythonVersion;
              this.pyodideVersion = message.pyodideVersion;
              this.finApi = message.finApi;
              finish();
              return;
            }
            this.receive(message);
          },
          onExit: (reason) => {
            if (!current()) return;
            this.process = null;
            const failure = new SandboxCrashError(`the calculator sandbox stopped: ${reason}`);
            this.settle(failure);
            if (this.state === "starting") {
              this.fail();
              finish(failure);
            } else if (this.state === "ready") {
              this.state = "idle";
            }
          },
        },
        this.options.env,
      );
      this.process = process;
    });
  }

  private receive(message: SandboxResponse): void {
    if (message.type === "log") {
      this.lastLog = message.message;
      return;
    }
    // A second `ready` (a respawn racing an old handler) answers no job.
    if (message.type === "ready") return;
    const pending = this.pending;
    if (!pending || pending.id !== message.id) return;
    clearTimeout(pending.timer);
    this.pending = null;
    pending.resolve(message);
  }

  private settle(error: Error): void {
    const pending = this.pending;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending = null;
    pending.reject(error);
  }

  private fail(): void {
    this.state = "failed";
    this.generation += 1;
    this.process?.kill();
    this.process = null;
  }

  private startIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => this.shutdown("idle"), IDLE_SHUTDOWN_MS);
    this.idleTimer.unref?.();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }
}
