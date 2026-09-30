/**
 * Install-time downloader for the calculator sandbox.
 *
 * Resolves the dependency closure of the calculator's Python roots from the pinned
 * Pyodide release, downloads every wheel from the CDN, verifies each SHA-256, and records
 * the result in `.sandbox/pyodide-<version>/packages.json` for the sandbox bundler.
 *
 * Run by `postinstall`, so it must never fail the install: every network or hash
 * problem is a warning and exit 0, leaving the calculator disabled until
 * `pnpm sandbox:fetch` succeeds. `--strict` (used in CI) turns failures into exit 1.
 *
 * Dependency-free ESM, Node >= 24, Windows/macOS/Linux.
 */

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

/** Python packages the calculator imports; their transitive `depends` come along. */
const ROOT_PACKAGES = ["numpy", "pandas", "scipy", "statsmodels"];

const CONCURRENCY = 4;
const REQUEST_TIMEOUT_MS = 60_000;
const RETRY_DELAY_MS = 1_000;
/** One retry: transient CDN hiccups are common, a broken proxy will not heal by trying twice. */
const ATTEMPTS = 2;

/** Resolve paths from this file, not cwd, so `node scripts/sandbox-fetch.mjs` works anywhere. */
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const pyodideDir = path.join(repoRoot, "node_modules", "pyodide");

const strict = process.argv.includes("--strict");

/**
 * Entry point. Never throws and never exits non-zero unless `--strict` was passed.
 *
 * @returns {Promise<void>}
 */
async function main() {
  const startedAt = Date.now();
  try {
    const version = await readPyodideVersion();
    const targetDir = path.join(repoRoot, ".sandbox", `pyodide-${version}`);
    const downloads = (await pyodideDownloads(version)).sort((a, b) => a.name.localeCompare(b.name));

    await mkdir(targetDir, { recursive: true });
    const results = await runPool(downloads, CONCURRENCY, (item) =>
      ensureFile(path.join(targetDir, item.fileName), item),
    );

    const failures = results.filter((r) => !r.ok);
    if (failures.length > 0) {
      // The folder no longer matches its manifest, so stop the bundler from trusting it.
      await rm(path.join(targetDir, "packages.json"), { force: true });
      reportFailures(failures, downloads.length);
      return finish(false);
    }

    await writeManifest(targetDir, version, downloads);
    reportSuccess(version, downloads, results, startedAt);
    finish(true);
  } catch (err) {
    warn(describeError(err));
    warn(
      "the calculator stays disabled; run `pnpm sandbox:fetch` to download the runtime packages.",
    );
    finish(false);
  }
}

/** Exit code: success is always 0, failure is 0 unless `--strict` asked otherwise. */
function finish(ok) {
  process.exitCode = ok || !strict ? 0 : 1;
}

/**
 * The Pyodide version is whatever pnpm installed; package.json pins it.
 *
 * @returns {Promise<string>}
 */
async function readPyodideVersion() {
  const manifest = await readJson(
    path.join(pyodideDir, "package.json"),
    "node_modules/pyodide is missing — run `pnpm install` first",
  );
  if (typeof manifest.version !== "string") {
    throw new Error("node_modules/pyodide/package.json has no version");
  }
  return manifest.version;
}

/**
 * Walk `depends` from ROOT_PACKAGES to the full closure of Pyodide packages to download.
 *
 * @param {string} version pinned Pyodide version, used to build the CDN URL
 * @returns {Promise<Array<{name: string, version: string, fileName: string, sha256: string, url: string}>>}
 */
async function pyodideDownloads(version) {
  const lock = await readJson(
    path.join(pyodideDir, "pyodide-lock.json"),
    "node_modules/pyodide/pyodide-lock.json is missing — reinstall the pyodide package",
  );
  const base = cdnBase(version);
  const packages = lock.packages ?? {};

  const closure = new Set();
  const missing = [];
  const queue = [...ROOT_PACKAGES];
  while (queue.length > 0) {
    const name = queue.pop();
    if (closure.has(name)) continue;
    const entry = packages[name];
    if (!entry) {
      missing.push(name);
      continue;
    }
    closure.add(name);
    queue.push(...(entry.depends ?? []));
  }
  if (missing.length > 0) {
    // A rename or removal upstream: pinning a new Pyodide needs the roots revisited.
    throw new Error(
      `pyodide-lock.json has no entry for ${missing.join(", ")} — update ROOT_PACKAGES in scripts/sandbox-fetch.mjs`,
    );
  }

  return [...closure].map((name) => {
    const entry = packages[name];
    return {
      name,
      version: entry.version,
      fileName: entry.file_name,
      sha256: entry.sha256,
      url: new URL(entry.file_name, base).href,
    };
  });
}

/**
 * Base URL of the Pyodide release's `full/` directory.
 * OFA_PYODIDE_CDN points the download at a mirror or an internal artifact store.
 */
function cdnBase(version) {
  const base = process.env.OFA_PYODIDE_CDN || `https://cdn.jsdelivr.net/pyodide/v${version}/full/`;
  // `new URL(fileName, base)` drops the last path segment unless the base ends in a slash.
  return base.endsWith("/") ? base : `${base}/`;
}

/**
 * Make sure one verified file exists at `target`, downloading it if needed.
 * Never throws: the pool keeps going so one dead URL does not hide the rest.
 *
 * @returns {Promise<{ok: boolean, item: object, cached: boolean, bytes: number, error?: string}>}
 */
async function ensureFile(target, item) {
  try {
    const cached = await cachedBytes(target, item.sha256);
    if (cached !== null) return { ok: true, item, cached: true, bytes: cached };

    const bytes = await withRetry(() => download(target, item));
    log(`downloaded ${item.name} ${item.version} (${formatSize(bytes)})`);
    return { ok: true, item, cached: false, bytes };
  } catch (err) {
    return { ok: false, item, cached: false, bytes: 0, error: describeError(err) };
  }
}

/**
 * Size of an already-correct file, or null when it is absent or its hash differs
 * (a truncated or tampered download is re-fetched rather than trusted).
 *
 * @returns {Promise<number | null>}
 */
async function cachedBytes(target, expected) {
  let size;
  try {
    size = (await stat(target)).size;
  } catch {
    return null;
  }
  const actual = await hashStream(createReadStream(target));
  return actual === expected ? size : null;
}

/**
 * Stream one file to `<name>.tmp`, hash it in flight, and only then move it into place,
 * so an interrupted or corrupt download never leaves a file the next run would trust.
 *
 * @returns {Promise<number>} bytes written
 */
async function download(target, item) {
  const tmp = `${target}.tmp`;
  const res = await fetch(item.url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${item.url}`);
  if (!res.body) throw new Error(`empty response for ${item.url}`);

  try {
    const hash = createHash("sha256");
    let bytes = 0;
    await pipeline(
      Readable.fromWeb(res.body),
      async function* (source) {
        for await (const chunk of source) {
          hash.update(chunk);
          bytes += chunk.length;
          yield chunk;
        }
      },
      createWriteStream(tmp),
    );

    const actual = hash.digest("hex");
    if (actual !== item.sha256) {
      throw new Error(`sha256 mismatch (expected ${item.sha256}, got ${actual})`);
    }
    await rename(tmp, target);
    return bytes;
  } finally {
    await rm(tmp, { force: true });
  }
}

/** SHA-256 of a readable stream, as lowercase hex. */
async function hashStream(stream) {
  const hash = createHash("sha256");
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}

/**
 * The manifest the sandbox bundler reads to learn what is installed, sorted by name
 * so the file is stable across runs and easy to diff.
 */
async function writeManifest(targetDir, version, downloads) {
  const manifest = {
    pyodideVersion: version,
    fetchedAt: new Date().toISOString(),
    packages: downloads.map((item) => ({
      name: item.name,
      version: item.version,
      fileName: item.fileName,
      sha256: item.sha256,
    })),
  };
  await writeFile(path.join(targetDir, "packages.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Run `worker` over `items` with at most `limit` in flight, preserving input order. */
async function runPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(lanes);
  return results;
}

/** Retry once after a short backoff; a second failure is reported to the caller. */
async function withRetry(fn) {
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < ATTEMPTS) await delay(RETRY_DELAY_MS * attempt);
    }
  }
  throw lastError;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One line per failure (capped), then the single warning an installing user needs. */
function reportFailures(failures, total) {
  for (const failure of failures.slice(0, 3)) {
    warn(`${failure.item.name}: ${failure.error}`);
  }
  if (failures.length > 3) warn(`... and ${failures.length - 3} more`);
  warn(
    `could not download ${failures.length} of ${total} calculator packages; the calculator stays disabled — run \`pnpm sandbox:fetch\` to retry.`,
  );
}

/** Quiet when nothing had to be downloaded: a warm `pnpm install` prints a single line. */
function reportSuccess(version, downloads, results, startedAt) {
  const cached = results.filter((r) => r.cached).length;
  const fetched = results.length - cached;
  const totalSize = formatSize(results.reduce((sum, r) => sum + r.bytes, 0));
  const elapsed = `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;

  if (fetched === 0) {
    log(`pyodide ${version}: ${downloads.length} packages cached (${totalSize}).`);
    return;
  }
  log(
    `pyodide ${version}: ${downloads.length} packages ready (${fetched} downloaded, ${cached} cached, ${totalSize} total) in ${elapsed}.`,
  );
}

async function readJson(file, missingMessage) {
  let raw;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    throw new Error(missingMessage);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${file} is not valid JSON: ${err.message}`);
  }
}

/** `fetch` hides the real reason (ECONNREFUSED, DNS) in `cause`; surface it. */
function describeError(err) {
  const message = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : "";
  return cause && !message.includes(cause) ? `${message} (${cause})` : message;
}

/** Human sizes: KB keeps the small pure-Python wheels from all reading "0.0 MB". */
function formatSize(bytes) {
  return bytes < 1_000_000 ? `${Math.round(bytes / 1_000)} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function log(message) {
  console.log(`[sandbox] ${message}`);
}

function warn(message) {
  console.warn(`[sandbox] ${message}`);
}

await main();
