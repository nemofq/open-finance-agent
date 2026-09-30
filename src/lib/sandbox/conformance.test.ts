import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureBundle } from "@/lib/sandbox/bundle";
import { SandboxPool } from "@/lib/sandbox/pool";
import type { BundleManifest, SandboxResult } from "@/lib/sandbox/protocol";
import { runSelfTest } from "@/lib/sandbox/selftest";
import { useConformanceHome } from "@/lib/sandbox/testing";

/**
 * The sandbox conformance suite: a real Deno, a real Pyodide, the real `fin`.
 *
 * Slow (a runtime folder is assembled and an interpreter boots), so it is opt-in with
 * `OFA_SANDBOX_TESTS=1`. CI runs it on Linux, macOS and Windows; the `fin` cases are also
 * computed in CPython here and compared, which is what proves the two interpreters agree.
 */

const enabled = process.env.OFA_SANDBOX_TESTS === "1";

const LONG = 300_000;

/**
 * The `fin` cases, each with the value Pyodide produces.
 *
 * WebAssembly arithmetic is IEEE-754 and Pyodide carries its own libm, so these are the same
 * bits on Linux, macOS and Windows. That exactness is what the golden tests promise, and it is
 * asserted against these pinned constants rather than against another interpreter.
 *
 * CPython is compared as well, because it is what proves `fin` runs the same algorithm in both
 * places — but only to a relative tolerance. CPython uses the platform's libm, and glibc, Apple's
 * and wasm's disagree in the last bit of `pow`, `exp`, `log` and everything built on them: macOS
 * CPython returns 0.09971358593414112 for the `xirr` case below, one ulp from the sandbox.
 */
const GOLDEN: { name: string; expression: string; expected: number }[] = [
  { name: "cagr", expression: "fin.cagr(318.0, 452.3, 4)", expected: 0.09206846629094789 },
  { name: "npv", expression: "fin.npv(0.1, [-100, 30, 40, 50])", expected: -2.1036814425244366 },
  { name: "irr", expression: "fin.irr([-100, 30, 40, 50])", expected: 0.08896339469334998 },
  {
    name: "xirr",
    expression: "fin.xirr([-1000, 1100], ['2024-01-01', '2025-01-01'])",
    expected: 0.09971358593414137,
  },
  {
    name: "xnpv",
    expression: "fin.xnpv(0.08, [-1000, 1100], ['2024-01-01', '2025-01-01'])",
    expected: 18.303784320634804,
  },
  {
    name: "volatility",
    expression: "fin.volatility([0.01, -0.02, 0.015, 0.004, -0.008])",
    expected: 0.2251719343079861,
  },
  { name: "max_drawdown", expression: "fin.max_drawdown([100, 120, 90, 110])", expected: -0.25 },
  {
    name: "sharpe",
    expression: "fin.sharpe([0.01, -0.02, 0.015, 0.004, -0.008], risk_free=0.03)",
    expected: 0.0925491188667188,
  },
  {
    name: "beta",
    expression: "fin.beta([0.01, -0.02, 0.015, 0.004], [0.008, -0.015, 0.012, 0.002])",
    expected: 1.3001765744555618,
  },
  { name: "black_scholes", expression: "fin.black_scholes(100, 100, 0.5, 0.3, 0.05)", expected: 9.634876628449177 },
  { name: "implied_vol", expression: "fin.implied_vol(9.35, 100, 100, 0.5, 0.05)", expected: 0.2896444362570262 },
  { name: "greeks_delta", expression: "fin.greeks(100, 100, 0.5, 0.3, 0.05).delta", expected: 0.5885891135975725 },
  {
    name: "dcf_per_share",
    expression: "fin.dcf([10, 11, 12], 0.09, terminal_growth=0.025, shares=100).per_share",
    expected: 1.7381986753251792,
  },
  {
    name: "reverse_dcf",
    expression: "fin.reverse_dcf(150.0, 10.0, 0.09, 0.025, years=10, shares=100)",
    expected: 0.6912486073699711,
  },
  { name: "wacc", expression: "fin.wacc(800.0, 200.0, 0.095, 0.05, 0.21)", expected: 0.08390000000000002 },
  { name: "concentration", expression: "fin.concentration([40, 30, 20, 10])", expected: 0.30000000000000004 },
  { name: "pmt", expression: "fin.pmt(0.005, 360, 300000.0)", expected: -1798.651575458271 },
  { name: "total_return", expression: "fin.total_return(100.0, 108.0, 3.5)", expected: 0.115 },
];

/** Room for one libm ulp, and nothing like enough to hide a wrong formula. */
const RELATIVE_TOLERANCE = 1e-12;

function emittedValues(result: SandboxResult): Record<string, number> {
  const out: Record<string, number> = {};
  for (const entry of result.emitted) {
    if (typeof entry.value === "number") out[entry.name] = entry.value;
  }
  return out;
}

/** The same expressions in the CPython that runs the `fin` unit tests. */
function cpythonValues(): Record<string, number> {
  const script = [
    "import json, sys",
    `sys.path.insert(0, ${JSON.stringify(path.join(process.cwd(), "sandbox"))})`,
    "import fin",
    `print(json.dumps({${GOLDEN.map((c) => `${JSON.stringify(c.name)}: float(${c.expression})`).join(", ")}}))`,
  ].join("\n");
  const python = process.platform === "win32" ? "python" : "python3";
  return JSON.parse(execFileSync(python, ["-c", script], { encoding: "utf8" })) as Record<string, number>;
}

/** One emit per case, in one job, so the whole table is computed on the same interpreter. */
function goldenCode(): string {
  return GOLDEN.map((c) => `emit(${JSON.stringify(c.name)}, ${c.expression})`).join("\n");
}

describe.runIf(enabled)("calculator sandbox", () => {
  useConformanceHome();
  let dir = "";
  let manifest: BundleManifest;
  let pool: SandboxPool;
  let bootMs = 0;

  beforeAll(async () => {
    const bundle = await ensureBundle();
    expect(bundle.status, bundle.message).toBe("ready");
    if (!bundle.manifest) throw new Error("the bundle reported ready without a manifest");
    dir = bundle.dir;
    manifest = bundle.manifest;
    pool = new SandboxPool({ dir, manifest });
    const started = Date.now();
    await pool.start();
    bootMs = Date.now() - started;
  }, LONG);

  afterAll(() => pool?.shutdown());

  function run(code: string, options: { timeoutMs?: number } = {}): Promise<SandboxResult> {
    return pool.runJob({ id: randomUUID(), code, evidence: {} }, options.timeoutMs ?? 30_000);
  }

  it("reports the pinned runtime when it becomes ready", () => {
    const status = pool.status();
    expect(status.state).toBe("ready");
    expect(status.pythonVersion).toMatch(/^3\.14\./);
    expect(status.pyodideVersion).toBe(manifest.pyodideVersion);
    expect(manifest.packages).toEqual(expect.arrayContaining(["numpy", "pandas", "scipy", "statsmodels"]));
    // The tool description is generated from this, so an empty reference would silently ship.
    expect(status.finApi).toContain("cagr(");
    // Generous: a warm start takes a few seconds; this only catches a hang.
    expect(bootMs).toBeLessThan(120_000);
  });

  it("computes the fin golden cases to the bit, on every operating system", async () => {
    const result = await run(goldenCode());
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.finVersion).toBe(manifest.finVersion);
    expect(emittedValues(result)).toEqual(Object.fromEntries(GOLDEN.map((c) => [c.name, c.expected])));
  }, LONG);

  it("agrees with CPython to within one libm ulp", async () => {
    const sandbox = emittedValues(await run(goldenCode()));
    const cpython = cpythonValues();
    for (const { name } of GOLDEN) {
      const expected = cpython[name];
      const actual = sandbox[name];
      const relative = expected === 0 ? Math.abs(actual) : Math.abs((actual - expected) / expected);
      expect(relative, `${name}: sandbox ${actual}, CPython ${expected}`).toBeLessThan(RELATIVE_TOLERANCE);
    }
  }, LONG);

  it("carries the fin formula and unit onto each emitted value", async () => {
    const result = await run('emit("growth", fin.cagr(318.0, 452.3, 4))');
    expect(result.emitted[0].unit).toBe("%");
    expect(result.emitted[0].formula).toContain("cagr");
  }, LONG);

  it("preloads an evidence table as a pandas DataFrame with its metadata", async () => {
    const result = await pool.runJob({
      id: randomUUID(),
      evidence: {
        E7: {
          columns: ["metric", "FY2024", "FY2025"],
          rows: [
            ["Revenues", 318.0, 452.3],
            ["NetIncome", 72.9, 110.4],
          ],
          index: "metric",
          meta: { id: "E7", summary: "EDGAR income statement", currency: "USD" },
        },
      },
      code: [
        'emit("revenue growth", fin.yoy(E7.loc["Revenues", "FY2025"], E7.loc["Revenues", "FY2024"]))',
        'emit("net margin", fin.margin(E7.loc["NetIncome", "FY2025"], E7.loc["Revenues", "FY2025"]))',
        'print(E7.attrs["currency"], type(E7).__name__)',
      ].join("\n"),
    }, 60_000);
    expect(result.error).toBeUndefined();
    expect(result.usedEvidence).toEqual(["E7"]);
    expect(result.stdout.trim()).toBe("USD DataFrame");
    const values = emittedValues(result);
    expect(values["revenue growth"]).toBeCloseTo(452.3 / 318.0 - 1, 12);
    expect(values["net margin"]).toBeCloseTo(110.4 / 452.3, 12);
  }, LONG);

  it("reports undeclared constants but still runs the code (rule P6)", async () => {
    const result = await run(
      ['wacc = 0.092', 'g = assume("terminal_growth", 0.025, "long-run nominal GDP growth")', 'emit("spread", wacc - g)'].join(
        "\n",
      ),
    );
    expect(result.ok).toBe(true);
    expect(result.assumptions).toEqual([
      { name: "terminal_growth", value: 0.025, why: "long-run nominal GDP growth" },
    ]);
    expect(result.undeclaredConstants).toEqual([{ value: 0.092, line: 1, snippet: "wacc = 0.092" }]);
    expect(emittedValues(result).spread).toBeCloseTo(0.067, 12);
  }, LONG);

  it("returns the model's own traceback for a failing calculation", async () => {
    const result = await run('emit("bad", fin.cagr(100, 200, 0))');
    expect(result.ok).toBe(false);
    expect(result.error).toContain("periods must be");
    // The host's frames are trimmed away; only the model's code is named.
    expect(result.error).toContain("<calculation>");
    expect(result.error).not.toContain("runner.py");
  }, LONG);

  // A hot loop and a blocking call reach the timeout by different routes; both must be killable,
  // and the boot that follows must not come out of the next job's time budget.
  it.each([
    { what: "a runaway loop", code: "while True:\n    pass" },
    { what: "a blocking sleep", code: "import time\ntime.sleep(60)" },
  ])("kills $what and serves the next job on a fresh interpreter", async ({ code }) => {
    await expect(run(code, { timeoutMs: 2_000 })).rejects.toThrow(/did not finish within 2s/);
    const after = await run('emit("alive", 1.0)', { timeoutMs: 20_000 });
    expect(emittedValues(after)).toEqual({ alive: 1 });
  }, LONG);

  it("recovers when os.system takes the interpreter down", async () => {
    // Three outcomes have all been seen and all are acceptable: Deno's permission check raises,
    // the fatal error takes the interpreter with it, or the call wedges until the timeout kills
    // the process. What must not happen is a shell running on the host, which the escape probes
    // cover, or a sandbox that stops answering, which is what this asserts.
    //
    // Written the long way round on purpose: the pre-check refuses a plain `os.system(...)` now,
    // and it is a quality layer rather than a boundary, so reaching past it is exactly how this
    // keeps testing what it was written to test.
    await run('__import__("os").system("echo escaped")', { timeoutMs: 5_000 }).catch(() => undefined);
    // If it wedged the interpreter without failing its own job, this one is killed on its timeout
    // and the retry lands on a process that was booted fresh.
    const after = await run('emit("alive", 2.0)', { timeoutMs: 20_000 }).catch(() =>
      run('emit("alive", 2.0)', { timeoutMs: 60_000 }),
    );
    expect(emittedValues(after)).toEqual({ alive: 2 });
  }, LONG);

  it("gives the same answer twice", async () => {
    const code = 'emit("bs", fin.black_scholes(137.25, 140, 0.0833, 0.41, 0.043))';
    const first = await run(code);
    const second = await run(code);
    expect(second.emitted).toEqual(first.emitted);
  }, LONG);

  it("can import every module name the manifest publishes", async () => {
    // The tool description promises this list and the pre-check enforces it, so a name that
    // cannot actually be imported would be a promise the runtime does not keep. Written as
    // static imports because that is what Pyodide's own import scanner reads.
    const code = [
      ...manifest.importNames.map((name) => `import ${name}`),
      `emit("imported", ${manifest.importNames.length})`,
    ].join("\n");
    const result = await run(code, { timeoutMs: 120_000 });
    expect(result.error).toBeUndefined();
    expect(emittedValues(result)).toEqual({ imported: manifest.importNames.length });
  }, LONG);

  it("refuses code that cannot run with one line, and runs none of it", async () => {
    const result = await run('import requests\nprint("ran")\nemit("x", 1.5)');
    expect(result.ok).toBe(false);
    expect(result.emitted).toEqual([]);
    // Nothing executed, so there is no traceback around it and nothing was printed.
    expect(result.stdout).toBe("");
    expect(result.error).not.toContain("Traceback");
    expect(result.error?.split("\n")).toHaveLength(1);
    expect(result.error).toContain("`import requests` (line 1)");
    expect(result.error).toContain("statsmodels");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  }, LONG);

  it.each([
    { what: "a file read", code: 'rows = open("data.csv").read()', says: "`evidence` ids" },
    { what: "a shell call", code: 'import os\nos.system("ls")', says: "cannot start processes" },
    { what: "a thread", code: "import threading", says: "single-threaded" },
    { what: "the host bridge", code: "import js", says: "sealed off from its host" },
  ])("tells the model why $what cannot work", async ({ code, says }) => {
    const result = await run(code);
    expect(result.ok).toBe(false);
    expect(result.error).toContain(says);
    // The interpreter is untouched by a rejection, so the next job runs on the same warm process.
    expect(emittedValues(await run('emit("alive", 1.0)'))).toEqual({ alive: 1 });
  }, LONG);

  it("blocks every escape probe", async () => {
    const verdict = await runSelfTest(dir, manifest);
    const escaped = verdict.probes.filter((probe) => !probe.blocked);
    expect(escaped, JSON.stringify(escaped, null, 2)).toEqual([]);
    expect(verdict.passed).toBe(true);
    // Every escape probe must actually have run.
    expect(verdict.probes.map((probe) => probe.name)).toEqual(
      expect.arrayContaining([
        "file_open_outside",
        "js_module_file_read",
        "js_module_fetch",
        "constructor_file_read",
        "constructor_env_read",
        "constructor_fetch",
        "nodefs_mount",
        "load_package_url",
        "urllib_loopback",
        "subprocess",
        "remote_import",
        "huge_allocation",
        "os_system",
        "loopback_listener",
      ]),
    );
  }, LONG);
});
