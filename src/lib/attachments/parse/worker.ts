/**
 * The worker thread one document is parsed in.
 *
 * Everything here runs away from the request thread, under `resourceLimits` and a timeout the
 * parent enforces, so a hostile file can cost at most one thread, one heap and thirty seconds.
 *
 * **This file is never bundled.** `parse/index.ts` starts it by absolute path, and Node runs it as
 * source: Node 24 strips the types itself, which is what makes one entry point work under vitest
 * and under a Turbopack build alike (see the note in `parse/index.ts`). Two consequences:
 *
 * 1. Nothing is imported statically except `node:` builtins — the resolver hooks below have to be
 *    in place before any of our modules load, and static imports are hoisted above everything.
 * 2. Every module this pulls in must be *erasable* TypeScript, and must import its types with
 *    `import type`. Node strips types without understanding them, so a plain
 *    `import { ParsedAttachment } from "../types"` becomes a real import of a name that does not
 *    exist at runtime, and the parse fails to load. `index.test.ts` loads every parser through
 *    this worker for exactly that reason.
 */

import { registerHooks } from "node:module";
import { parentPort, workerData } from "node:worker_threads";
import type { ParsedAttachment } from "../types";
import type { ParseRequest, ParseResponse } from "./index";

/** `src/`, resolved from this file at `src/lib/attachments/parse/worker.ts`. */
const SRC = new URL("../../../", import.meta.url);

/** What `tsconfig.json` maps `@/*` to, and the extensions its `moduleResolution: "bundler"` infers. */
const SUFFIXES = [".ts", ".tsx", "/index.ts", ".js", "/index.js"];

/**
 * Teach Node the two things the bundler does for free: the `@/` alias, and module specifiers with
 * no file extension. Synchronous hooks, so they are live for the dynamic import below without a
 * second thread getting involved.
 */
registerHooks({
  resolve(specifier, context, nextResolve) {
    const target = specifier.startsWith("@/") ? new URL(specifier.slice(2), SRC).href : specifier;
    try {
      return nextResolve(target, context);
    } catch (err) {
      // Only a relative or aliased specifier can be missing an extension; a bare one that does not
      // resolve is a genuinely absent package, and guessing suffixes for it would hide that.
      if (!target.startsWith(".") && !target.startsWith("file:")) throw err;
      for (const suffix of SUFFIXES) {
        try {
          return nextResolve(target + suffix, context);
        } catch {
          // keep trying; the original error is the one worth reporting
        }
      }
      throw err;
    }
  },
});

const request = workerData as ParseRequest;

/** Dynamically loads the parser registry and executes the parse request in this worker. */
const reply = async (): Promise<ParseResponse> => {
  try {
    const { runParser } = (await import("./registry")) as { runParser(request: ParseRequest): Promise<ParsedAttachment> };
    return { ok: true, parsed: await runParser(request) };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
};

parentPort?.postMessage(await reply());
