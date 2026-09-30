/**
 * `public/pdf.worker.min.mjs` is not committed: `scripts/copy-pdf-worker.mjs` puts it there at
 * install time. These tests are what turns a stale or missing worker from a runtime failure in
 * the browser — PDF attachments silently refusing to render — into a red test.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const served = path.join(repoRoot, "public", "pdf.worker.min.mjs");
const installed = path.join(
  path.dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json")),
  "build",
  "pdf.worker.min.mjs",
);

/** The URL `prepare-pdf.ts` hands pdfjs, which is `public/` plus the file name the script copies. */
const WORKER_URL = "/pdf.worker.min.mjs";

const fix = "run `pnpm pdf:worker` (or `pnpm install`) to copy it from node_modules/pdfjs-dist";

/** Reading through a helper so an absent file fails with the fix rather than a bare ENOENT. */
function sha256(file: string): string {
  try {
    return createHash("sha256").update(readFileSync(file)).digest("hex");
  } catch (err) {
    throw new Error(`cannot read ${file} — ${fix}.`, { cause: err });
  }
}

describe("the pdf.js worker served from public/", () => {
  it("is there at all", () => {
    expect(
      existsSync(served),
      `public/pdf.worker.min.mjs is missing — it is generated, not committed: ${fix}.`,
    ).toBe(true);
  });

  it("is the worker from the installed pdfjs-dist", () => {
    expect(
      sha256(served),
      `public/pdf.worker.min.mjs does not match the installed pdfjs-dist worker, so PDF attachments would load a mismatched worker in the browser: ${fix}.`,
    ).toBe(sha256(installed));
  });

  it("is the file prepare-pdf.ts points pdfjs at", () => {
    const source = readFileSync(path.join(repoRoot, "src", "components", "chat", "composer", "prepare-pdf.ts"), "utf8");
    // Hash equality above proves the copy is current; only this proves the app asks for that copy.
    expect(
      source.includes(`workerSrc = "${WORKER_URL}"`),
      `prepare-pdf.ts no longer sets workerSrc to "${WORKER_URL}" — scripts/copy-pdf-worker.mjs writes public${WORKER_URL}, so change both or PDF rendering breaks with a 404 for the worker.`,
    ).toBe(true);
  });
});
