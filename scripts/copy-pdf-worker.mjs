/**
 * Copies the installed pdfjs-dist worker to public/pdf.worker.min.mjs at install time. A failed
 * copy only warns, so an install never breaks on it, except under CI, where it fails the step
 * rather than leave PDF attachments to break at run time.
 */

import { copyFile, mkdir, rename, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The file name is also the URL path `prepare-pdf.ts` sets as `workerSrc`. */
const WORKER_FILE = "pdf.worker.min.mjs";
/** Resolved from this file, not cwd, so `node scripts/copy-pdf-worker.mjs` works anywhere. */
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const target = path.join(publicDir, WORKER_FILE);
const tmp = `${target}.tmp`;

try {
  // Node resolution, because pnpm symlinks pdfjs-dist into a versioned store folder.
  const require = createRequire(import.meta.url);
  const manifestPath = require.resolve("pdfjs-dist/package.json");
  await mkdir(publicDir, { recursive: true });
  // Copied beside the target and moved into place, so an interrupted install never leaves half a worker.
  await copyFile(path.join(path.dirname(manifestPath), "build", WORKER_FILE), tmp);
  await rename(tmp, target);
  console.log(`[pdf-worker] pdfjs-dist ${require(manifestPath).version}: copied the worker to public/${WORKER_FILE}.`);
} catch (err) {
  console.warn(`[pdf-worker] ${err instanceof Error ? err.message : String(err)}`);
  console.warn("[pdf-worker] PDF attachments will fail to render; run `pnpm pdf:worker` to copy the worker into public/.");
  if (process.env.CI) process.exitCode = 1;
} finally {
  await rm(tmp, { force: true });
}
