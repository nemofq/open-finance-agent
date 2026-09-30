import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BundleManifest } from "@/lib/sandbox/protocol";
import type { PoolState } from "@/lib/sandbox/pool";

/**
 * The warm-up contract, with the bundle, the isolation check and the process all mocked: this is
 * about when the runtime is asked to boot, which needs no Deno and no Pyodide. The conformance
 * suite covers the real thing.
 */

const manifest: BundleManifest = {
  pyodideVersion: "314.0.7",
  finVersion: "1.0.0",
  packages: ["numpy", "pandas", "python-dateutil"],
  headline: ["numpy", "pandas"],
  importNames: ["dateutil", "fin", "numpy", "pandas"],
  preload: ["numpy", "pandas"],
  sourcesHash: "a".repeat(64),
};

const pool = vi.hoisted(() => ({
  state: "ready" as PoolState,
  warm: vi.fn(),
  start: vi.fn(async () => undefined),
  shutdown: vi.fn(),
  runJob: vi.fn(),
  status: vi.fn(),
}));
pool.status.mockImplementation(() => ({ state: pool.state, finApi: "cagr(begin, end, periods)" }));

// A class, because the module under test calls `new SandboxPool(...)`.
vi.mock("@/lib/sandbox/pool", () => ({
  SandboxPool: class {
    constructor() {
      return pool;
    }
  },
}));
vi.mock("@/lib/sandbox/bundle", () => ({
  ensureBundle: vi.fn(async () => ({ status: "ready", dir: "/runtime/calc", manifest })),
}));
vi.mock("@/lib/sandbox/selftest", () => ({
  readVerdict: vi.fn(async () => ({ passed: true, probes: [], pyodideVersion: "314.0.7" })),
  runSelfTest: vi.fn(),
  describeFailure: vi.fn(() => "a probe escaped"),
}));

const { ensureSandbox, getSandboxStatus, shutdownSandbox, warmSandbox } = await import("@/lib/sandbox");

beforeEach(() => {
  pool.state = "ready";
  pool.warm.mockClear();
});

describe("warmSandbox", () => {
  it("does nothing before the runtime has ever been started", () => {
    warmSandbox();
    expect(pool.warm).not.toHaveBeenCalled();
  });

  it("boots the process in the background once the runtime is ready", async () => {
    const status = await ensureSandbox();
    expect(status.state).toBe("ready");
    // Settings keeps the readable few; the tool description gets the whole importable inventory.
    expect(status.packages).toEqual(["numpy", "pandas"]);
    expect(status.importNames).toEqual(["dateutil", "fin", "numpy", "pandas"]);

    warmSandbox();
    expect(pool.warm).toHaveBeenCalledTimes(1);
  });

  it("is the same runtime in another copy of the module, as instrumentation and a route each load one", async () => {
    vi.resetModules();
    const copy = await import("@/lib/sandbox");
    expect(copy.getSandboxStatus().state).toBe("ready");
    copy.warmSandbox();
    expect(pool.warm).toHaveBeenCalledTimes(1);
  });

  it("warms an idle pool, which is the state the fifteen-minute shutdown leaves behind", () => {
    pool.state = "idle";
    warmSandbox();
    expect(pool.warm).toHaveBeenCalledTimes(1);
    // The published status still says ready, because the runtime is fine and only the process went.
    expect(getSandboxStatus().state).toBe("ready");
  });

  it("leaves a pool that failed to boot alone rather than spawning a process per turn", () => {
    pool.state = "failed";
    warmSandbox();
    expect(pool.warm).not.toHaveBeenCalled();
  });

  it("does nothing again after the runtime is shut down", () => {
    shutdownSandbox();
    warmSandbox();
    expect(pool.warm).not.toHaveBeenCalled();
  });
});
