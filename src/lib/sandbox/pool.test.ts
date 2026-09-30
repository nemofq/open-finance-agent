import { describe, expect, it, vi } from "vitest";
import type { SandboxProcessHandlers } from "@/lib/sandbox/process";
import type { BundleManifest } from "@/lib/sandbox/protocol";

/** A boot that dies, with the process mocked: the host logs why, then exits. */

vi.mock("@/lib/sandbox/process", () => ({
  SandboxProcess: class {
    alive = true;
    constructor(_dir: string, handlers: SandboxProcessHandlers) {
      setTimeout(() => {
        handlers.onResponse({ type: "log", message: "sandbox host failed to start: manifest.json is missing" });
        this.alive = false;
        handlers.onExit("sandbox exited (code 1, signal none)");
      });
    }
    kill(): void {}
  },
}));

const { SandboxPool } = await import("@/lib/sandbox/pool");
const options = { dir: "/runtime/calc", manifest: { pyodideVersion: "314.0.7" } as BundleManifest };

describe("a failed boot", () => {
  it("says what the host last logged, for Settings", async () => {
    const pool = new SandboxPool(options);
    await expect(pool.start()).rejects.toThrow(
      "the calculator sandbox stopped: sandbox exited (code 1, signal none); last host output: sandbox host failed to start: manifest.json is missing",
    );
    expect(pool.status().state).toBe("failed");
  });

  it("leaves the error a job hands the model as it was", async () => {
    const pool = new SandboxPool(options);
    await expect(pool.runJob({ id: "job-1", code: "", evidence: {} }, 1_000)).rejects.toThrow(
      /^the calculator sandbox stopped: sandbox exited \(code 1, signal none\)$/,
    );
  });
});
