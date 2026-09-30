import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import path from "node:path";
import { dataDir } from "@/lib/paths";
import { SandboxPool } from "@/lib/sandbox/pool";
import type { BundleManifest, SandboxSelfTestResult } from "@/lib/sandbox/protocol";
import { errorMessage } from "@/lib/utils";

/**
 * The isolation check: the escape probes run against a throwaway
 * sandbox while this side holds the things they try to reach — a canary file outside the runtime
 * folder, the same token in the child's environment, and a loopback listener.
 *
 * Python's own verdict is not trusted on its own. Two probes are judged here instead, because
 * only this side can see them: whether anything connected to the listener, and whether a shell
 * ever ran (`os.system` can kill the interpreter before it could report either way).
 *
 * The verdict is cached in the runtime folder, and changed sources are assembled into a new
 * folder, so a changed `fin` or Pyodide is always re-checked.
 */

export interface SelfTestVerdict {
  passed: boolean;
  probes: { name: string; blocked: boolean; detail?: string }[];
  pyodideVersion: string;
  finVersion: string;
  checkedAt: string;
}

interface Canary {
  dir: string;
  file: string;
  marker: string;
  token: string;
  envName: string;
}

/** The environment variable the child is given, so a successful `Deno.env.get` is visible. */
const CANARY_ENV = "OFA_SANDBOX_CANARY";

function verdictPath(dir: string): string {
  return path.join(dir, "selftest.json");
}

/** A file, a marker path and a token, all outside the folder Deno may read. */
async function plantCanary(): Promise<Canary> {
  const dir = path.join(dataDir(), "sandbox-selftest");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const token = `ofa-canary-${randomUUID()}`;
  const file = path.join(dir, `${token}.txt`);
  await writeFile(file, `${token}\n`, "utf8");
  return { dir, file, marker: path.join(dir, `${token}.marker`), token, envName: CANARY_ENV };
}

/** A loopback listener on an ephemeral port. Any connection at all means the sandbox has network. */
function listen(): Promise<{ port: number; server: Server; wasHit: () => boolean }> {
  return new Promise((resolve, reject) => {
    let hit = false;
    const server = createServer((socket) => {
      hit = true;
      socket.destroy();
    });
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("could not open the loopback canary listener"));
        return;
      }
      resolve({ port: address.port, server, wasHit: () => hit });
    });
  });
}

async function exists(file: string): Promise<boolean> {
  try {
    await readFile(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run every escape probe against a fresh sandbox and decide whether the calculator may run.
 *
 * A probe that could not be run at all counts as a failure: the point is proof, not absence of
 * evidence.
 */
export async function runSelfTest(dir: string, manifest: BundleManifest): Promise<SelfTestVerdict> {
  const canary = await plantCanary();
  const listener = await listen();
  // A throwaway pool: it carries the canary in its environment and `os.system` may kill it.
  const pool = new SandboxPool({ dir, manifest, env: { [canary.envName]: canary.token } });

  const probes: SandboxSelfTestResult["probes"] = [];
  try {
    const result = await pool.runSelfTest({
      id: randomUUID(),
      canaryPath: canary.file,
      canaryPort: listener.port,
      canaryToken: canary.token,
      canaryEnv: canary.envName,
      markerPath: canary.marker,
    });
    probes.push(...result.probes);

    const shellRan = await exists(canary.marker);
    const subprocessRan = await exists(`${canary.marker}.subprocess`);
    probes.push({
      name: "os_system",
      blocked: !shellRan,
      detail: shellRan ? "a shell ran on the host" : "no shell ran; the marker file was never created",
    });
    if (subprocessRan) {
      // The Python-side probe already reports this, but a marker proves it independently.
      probes.push({ name: "subprocess_marker", blocked: false, detail: "a shell ran on the host" });
    }
    probes.push({
      name: "loopback_listener",
      blocked: !listener.wasHit(),
      detail: listener.wasHit() ? "the sandbox connected to the canary port" : "the canary port was never reached",
    });
  } catch (err) {
    probes.push({
      name: "selftest_ran",
      blocked: false,
      detail: `the isolation check could not run: ${errorMessage(err)}`,
    });
  } finally {
    pool.shutdown("self-test finished");
    listener.server.close();
    await rm(canary.dir, { recursive: true, force: true });
  }

  const verdict: SelfTestVerdict = {
    passed: probes.length > 0 && probes.every((probe) => probe.blocked),
    probes,
    pyodideVersion: manifest.pyodideVersion,
    finVersion: manifest.finVersion,
    checkedAt: new Date().toISOString(),
  };
  await writeFile(verdictPath(dir), `${JSON.stringify(verdict, null, 2)}\n`, "utf8").catch(() => undefined);
  return verdict;
}

/** The stored verdict for this runtime folder, or null when it has not been checked yet. */
export async function readVerdict(dir: string, manifest: BundleManifest): Promise<SelfTestVerdict | null> {
  try {
    const stored = JSON.parse(await readFile(verdictPath(dir), "utf8")) as SelfTestVerdict;
    const matches =
      stored.pyodideVersion === manifest.pyodideVersion && stored.finVersion === manifest.finVersion;
    return matches ? stored : null;
  } catch {
    return null;
  }
}

/** One line naming what escaped, for Settings and the logs. */
export function describeFailure(verdict: SelfTestVerdict): string {
  const escaped = verdict.probes.filter((probe) => !probe.blocked).map((probe) => probe.name);
  return `the calculator sandbox failed its isolation check (${escaped.join(", ")}); the tool stays disabled`;
}
