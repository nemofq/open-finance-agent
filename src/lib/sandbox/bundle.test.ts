import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ensureBundle } from "./bundle";
import type { BundleManifest } from "./protocol";

/**
 * Assembly is offline and needs no Deno, so this runs in the default suite. It does need the
 * downloaded wheels, which `pnpm sandbox:fetch` provides; without them the bundler must say so
 * rather than assembling something half-built.
 */

let home = "";
let original: string | undefined;

beforeAll(async () => {
  original = process.env.OFA_HOME;
  home = await mkdtemp(path.join(os.tmpdir(), "ofa-bundle-"));
  process.env.OFA_HOME = home;
});

afterAll(async () => {
  if (original === undefined) delete process.env.OFA_HOME;
  else process.env.OFA_HOME = original;
  await rm(home, { recursive: true, force: true });
});

describe("ensureBundle", () => {
  it("assembles a self-contained runtime folder named for both versions and its sources", async () => {
    const result = await ensureBundle();
    if (result.status === "missing") {
      expect(result.message).toContain("pnpm sandbox:fetch");
      return;
    }

    const manifest = result.manifest as BundleManifest;
    expect(path.basename(result.dir)).toBe(
      `calc-${manifest.pyodideVersion}-${manifest.finVersion}-${manifest.sourcesHash.slice(0, 8)}`,
    );
    expect(path.dirname(result.dir)).toBe(path.join(home, "runtime"));

    // Everything the host needs, and the wheels it loads packages from, with no network.
    for (const file of [
      "host.ts",
      "protocol.ts",
      "manifest.json",
      "pyodide/pyodide.mjs",
      "pyodide/pyodide.asm.wasm",
      "pyodide/python_stdlib.zip",
      "pyodide/pyodide-lock.json",
      "python/runner.py",
      "python/precheck.py",
      "python/selftest.py",
      "python/fin/__init__.py",
    ]) {
      await expect(stat(path.join(result.dir, ...file.split("/")))).resolves.toBeTruthy();
    }

    // The `fin` tests are the one thing deliberately left out: they are not part of the runtime.
    await expect(stat(path.join(result.dir, "python", "fin", "tests"))).rejects.toThrow();

    expect(manifest.preload).toEqual(["numpy", "pandas"]);
    expect(manifest.packages).toEqual(expect.arrayContaining(["numpy", "pandas", "scipy", "statsmodels"]));
    expect(manifest.headline[0]).toBe("numpy");
    // The names the model types, not the names pip knows: they differ here, and the pre-check
    // and the tool description are only right if this list is.
    expect(manifest.importNames).toEqual(expect.arrayContaining(["fin", "numpy", "dateutil"]));
    expect(manifest.importNames).not.toContain("python-dateutil");
    expect(manifest.importNames).toEqual([...manifest.importNames].sort());
    expect(manifest.sourcesHash).toMatch(/^[0-9a-f]{64}$/);
  }, 120_000);

  it("reuses the folder when nothing changed", async () => {
    const first = await ensureBundle();
    if (first.status === "missing") return;
    const stamp = path.join(first.dir, "marker.txt");
    await writeFile(stamp, "kept", "utf8");

    const second = await ensureBundle();
    expect(second.dir).toBe(first.dir);
    expect(second.manifest?.sourcesHash).toBe(first.manifest?.sourcesHash);
    // A rebuild would have replaced the folder, so the marker proves the copy was skipped.
    await expect(readFile(stamp, "utf8")).resolves.toBe("kept");
  }, 120_000);

  it("leaves a folder that does not hold what its name promises, and says so", async () => {
    const first = await ensureBundle();
    if (first.status === "missing") return;
    const manifestPath = path.join(first.dir, "manifest.json");
    const stored = await readFile(manifestPath, "utf8");
    const manifest = JSON.parse(stored) as BundleManifest;
    await writeFile(manifestPath, JSON.stringify({ ...manifest, sourcesHash: "stale" }, null, 2), "utf8");
    try {
      // Whatever is in it, a process may be running from it, so it is never replaced.
      await expect(ensureBundle()).rejects.toThrow(/delete it and try again/);
      await expect(stat(path.join(first.dir, "host.ts"))).resolves.toBeTruthy();
    } finally {
      await writeFile(manifestPath, stored, "utf8");
    }
  }, 120_000);
});

describe("ensureBundle, several at once", () => {
  let shared = "";

  beforeEach(async () => {
    // Each case needs a runtime folder that does not exist yet.
    shared = await mkdtemp(path.join(os.tmpdir(), "ofa-bundle-race-"));
    process.env.OFA_HOME = shared;
  });

  afterEach(async () => {
    process.env.OFA_HOME = home;
    await rm(shared, { recursive: true, force: true });
  });

  it("agrees on one complete folder when assemblies of the same version race", async () => {
    // Two conformance files, or two servers on one data folder, assembling a new version together.
    const results = await Promise.all([ensureBundle(), ensureBundle(), ensureBundle()]);
    if (results.some((result) => result.status === "missing")) return;

    const [first] = results;
    for (const result of results) {
      expect(result.status).toBe("ready");
      expect(result.dir).toBe(first.dir);
      expect(result.manifest?.sourcesHash).toBe(first.manifest?.sourcesHash);
    }
    // The winner's folder is complete, and the losers left no staging folder behind.
    const manifest = JSON.parse(await readFile(path.join(first.dir, "manifest.json"), "utf8")) as BundleManifest;
    expect(manifest.sourcesHash).toBe(first.manifest?.sourcesHash);
    for (const file of ["host.ts", "pyodide/pyodide.asm.wasm", "python/fin/__init__.py"]) {
      await expect(stat(path.join(first.dir, ...file.split("/")))).resolves.toBeTruthy();
    }
    expect(await readdir(path.join(shared, "runtime"))).toEqual([path.basename(first.dir)]);
  }, 120_000);

  it("keeps a folder already in place while a later assembly of it runs", async () => {
    const first = await ensureBundle();
    if (first.status === "missing") return;
    const stamp = path.join(first.dir, "marker.txt");
    await writeFile(stamp, "in use", "utf8");

    await Promise.all([ensureBundle(), ensureBundle()]);
    await expect(readFile(stamp, "utf8")).resolves.toBe("in use");
  }, 120_000);

  it("sweeps a staging folder a crashed assembly abandoned, and no other", async () => {
    const runtime = path.join(shared, "runtime");
    const abandoned = path.join(runtime, "calc-0-0-00000000.tmp-dead0000");
    const inFlight = path.join(runtime, "calc-0-0-00000000.tmp-live0000");
    await mkdir(abandoned, { recursive: true });
    await mkdir(inFlight, { recursive: true });
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(abandoned, twoHoursAgo, twoHoursAgo);

    const result = await ensureBundle();
    if (result.status === "missing") return;
    await expect(stat(abandoned)).rejects.toThrow();
    await expect(stat(inFlight)).resolves.toBeTruthy();
  }, 120_000);
});
