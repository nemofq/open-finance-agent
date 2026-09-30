import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLedger } from "@/lib/evidence/ledger";
import type { SandboxStatus } from "@/lib/sandbox/protocol";
import type { ModuleContext } from "@/lib/tools/contracts";

/**
 * The module's own behaviour, with the sandbox mocked: registration must fail closed, and the
 * description must be generated from whatever runtime is actually there.
 */

const ready: SandboxStatus = {
  state: "ready",
  isolation: "passed",
  pythonVersion: "3.14.2",
  pyodideVersion: "314.0.6",
  packages: ["numpy", "pandas", "scipy", "statsmodels"],
  importNames: ["dateutil", "fin", "numpy", "pandas", "scipy", "statsmodels"],
  finVersion: "1.0.0",
  finApi: "Growth\n  cagr(begin, end, periods) - compound annual growth rate as a decimal\n",
};

const sandbox = vi.hoisted(() => ({ status: { state: "ready" } as SandboxStatus }));

vi.mock("@/lib/sandbox", () => ({
  ensureSandbox: vi.fn(async () => sandbox.status),
  runCalculation: vi.fn(),
}));

const { pythonModule, resolveTimeoutMs } = await import("./tool");
const { statusLine, toolDescription } = await import("./description");

function context(): ModuleContext & { logs: string[] } {
  const logs: string[] = [];
  return { log: (msg) => logs.push(msg), session: { id: "test" }, evidence: createLedger({ sessionId: "test" }), logs };
}

beforeEach(() => {
  sandbox.status = ready;
});

describe("pythonModule", () => {
  it("declares itself as a financial tool keeping the python id", () => {
    expect(pythonModule.id).toBe("python");
    expect(pythonModule.kind).toBe("financial-tool");
    expect(pythonModule.settings.map((field) => field.key)).toEqual(["timeoutSeconds"]);
    expect(pythonModule.defaultConfig).toEqual({ enabled: true, timeoutSeconds: 10 });
  });

  it("registers one tool with finance compute metadata when the sandbox is usable", async () => {
    const tools = await pythonModule.createTools({ timeoutSeconds: 10 }, context());
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("financial_calculator");
    expect(tools[0].meta).toEqual({ class: "finance", effect: "compute" });
    const schema = tools[0].parameters as { properties: Record<string, unknown>; required?: string[] };
    expect(Object.keys(schema.properties)).toEqual(["code", "evidence"]);
    expect(schema.required).toEqual(["code"]);
  });

  it("registers nothing and says why when the runtime is missing", async () => {
    sandbox.status = { state: "missing", isolation: "untested", message: "run `pnpm sandbox:fetch`" };
    const ctx = context();
    expect(await pythonModule.createTools({}, ctx)).toEqual([]);
    expect(ctx.logs[0]).toContain("pnpm sandbox:fetch");
  });

  it("registers nothing when the isolation check did not pass", async () => {
    sandbox.status = { state: "ready", isolation: "failed", message: "constructor_fetch escaped" };
    const ctx = context();
    expect(await pythonModule.createTools({}, ctx)).toEqual([]);
    expect(ctx.logs[0]).toContain("constructor_fetch escaped");
  });

  it("reports the runtime it validated", async () => {
    await expect(pythonModule.validate?.({})).resolves.toEqual({ ok: true, message: statusLine(ready) });
    sandbox.status = { state: "failed", isolation: "failed", message: "nodefs_mount escaped" };
    await expect(pythonModule.validate?.({})).resolves.toMatchObject({ ok: false });
  });
});

describe("resolveTimeoutMs", () => {
  it("defaults to 10 seconds and clamps to the documented range", () => {
    expect(resolveTimeoutMs({})).toBe(10_000);
    expect(resolveTimeoutMs({ timeoutSeconds: "nonsense" })).toBe(10_000);
    expect(resolveTimeoutMs({ timeoutSeconds: 30 })).toBe(30_000);
    expect(resolveTimeoutMs({ timeoutSeconds: 0 })).toBe(1_000);
    expect(resolveTimeoutMs({ timeoutSeconds: 600 })).toBe(60_000);
  });

  it("reads a typed-in number, and a cleared box as the default rather than the one-second floor", () => {
    expect(resolveTimeoutMs({ timeoutSeconds: " 20 " })).toBe(20_000);
    expect(resolveTimeoutMs({ timeoutSeconds: "" })).toBe(10_000);
    expect(resolveTimeoutMs({ timeoutSeconds: null })).toBe(10_000);
  });
});

describe("statusLine", () => {
  it("names the runtime, packages, fin version and isolation check when everything is in place", () => {
    expect(statusLine(ready)).toBe(
      "Ready · Python 3.14.2 (Pyodide 314.0.6) · numpy, pandas, scipy, statsmodels · fin 1.0.0 · isolation check passed",
    );
  });

  it("tells the user what to do when the runtime is missing", () => {
    expect(statusLine({ state: "missing", message: "run `pnpm sandbox:fetch`" })).toBe(
      "Not available · run `pnpm sandbox:fetch`",
    );
  });
});

describe("toolDescription", () => {
  it("names only the libraries the runtime has and embeds fin's own API reference", () => {
    const description = toolDescription(ready);
    expect(description).toContain("Python 3.14.2 (Pyodide 314.0.6)");
    expect(description).toContain("cagr(begin, end, periods)");
    expect(description).not.toContain("QuantLib");
  });

  it("publishes the whole inventory by import name, and says nothing else can be imported", () => {
    const description = toolDescription(ready);
    // The model types `dateutil`, so that is what it is told, not the pip name.
    expect(description).toContain(
      "Libraries, by the name you import them under: dateutil, fin, numpy, pandas, scipy, statsmodels, plus the Python standard library.",
    );
    expect(description).toContain("there is no pip and no network");
    expect(description).toContain("scipy and statsmodels load on first import");
  });

  it("falls back to the Settings list when the runtime reported no import names", () => {
    const description = toolDescription({ ...ready, importNames: undefined });
    expect(description).toContain("numpy, pandas, scipy, statsmodels, plus the Python standard library.");
  });

  it("teaches the three rules the enforcement engine depends on", () => {
    const description = toolDescription(ready);
    expect(description).toContain("assume(name, value, why)");
    expect(description).toContain("emit(name, value, unit=None)");
    expect(description).toContain("Never retype a number");
  });

  it("leaves the API section out rather than inventing one", () => {
    expect(toolDescription({ ...ready, finApi: undefined })).not.toContain("fin API:");
  });
});
