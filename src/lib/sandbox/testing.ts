import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll } from "vitest";

/**
 * The data folder for one conformance file, registered as hooks of the calling `describe` so that
 * they run before its own. An OFA_HOME from the environment wins, which is how CI runs the suite
 * from a long non-ASCII Windows path; otherwise the file gets a fresh folder of its own and removes
 * it afterwards. A fallback shared by every file, and by every checkout on the machine, let two
 * runs assemble into one folder at once.
 */
export function useConformanceHome(): void {
  let created: string | undefined;

  beforeAll(() => {
    if (process.env.OFA_HOME) return;
    created = mkdtempSync(path.join(os.tmpdir(), "ofa-sandbox-conformance-"));
    process.env.OFA_HOME = created;
  });

  afterAll(() => {
    if (!created) return;
    delete process.env.OFA_HOME;
    // Deno may still be letting go of the folder on Windows; a leftover in tmp is harmless.
    rmSync(created, { recursive: true, force: true, maxRetries: 3 });
  });
}
