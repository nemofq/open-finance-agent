import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { createLineReader, type LineReader } from "@/lib/sandbox/lines";
import type { SandboxRequest, SandboxResponse } from "@/lib/sandbox/protocol";

/**
 * One Deno process running the sandbox host, spoken to in JSON lines over stdin and stdout.
 *
 * The permissions below are the security boundary. Never add `--allow-net`, `--allow-env`,
 * `--allow-write`, `--allow-sys`, `--allow-run` or `--allow-ffi`: Deno treats the last two as
 * full access, and the others each undo one of the properties the calculator promises.
 */

/** 16,384 WebAssembly pages of 64 KiB: a 1 GiB ceiling that surfaces as MemoryError in Python. */
const WASM_MAX_MEM_PAGES = 16_384;

/** Anything this large on one line is a runaway, not a result. */
const MAX_LINE_BYTES = 8 * 1024 * 1024;

export interface SandboxProcessHandlers {
  onResponse(message: SandboxResponse): void;
  /** The process ended, whether it was killed, crashed, or exited on its own. */
  onExit(reason: string): void;
}

/**
 * The Deno binary from the installed `deno` package, never from PATH.
 *
 * `deno` is a launcher that resolves a per-platform package; this mirrors its `getTarget()` so
 * the binary is found without running the launcher (which would need a shell and a PATH lookup).
 */
export function resolveDenoBinary(): string {
  const fromRepo = createRequire(path.join(process.cwd(), "package.json"));
  // Resolved at run time on the user's machine; the bundler must not trace the launcher package.
  const fromDeno = createRequire(fromRepo.resolve(/* turbopackIgnore: true */ "deno/package.json"));
  const arch = os.arch();
  if (arch !== "x64" && arch !== "arm64") {
    throw new Error(`the calculator sandbox needs an x64 or arm64 machine, not ${arch}`);
  }
  // Deno ships no musl build; the npm package throws for musl, and so would we.
  const target = os.platform() === "linux" ? `linux-${arch}-glibc` : `${os.platform()}-${arch}`;
  const packageDir = path.dirname(fromDeno.resolve(`@deno/${target}/package.json`));
  return path.join(packageDir, os.platform() === "win32" ? "deno.exe" : "deno");
}

export function denoArguments(runtimeDir: string): string[] {
  return [
    "run",
    "--no-prompt",
    "--no-remote",
    "--no-config",
    "--no-lock",
    `--allow-read=${runtimeDir}`,
    `--v8-flags=--wasm-max-mem-pages=${WASM_MAX_MEM_PAGES}`,
    path.join(runtimeDir, "host.ts"),
  ];
}

/**
 * The whole environment the sandbox gets: no PATH, no API keys, nothing inherited.
 *
 * Deno still wants a home and a module cache, so both point at paths we own — the cache beside
 * the runtime folder rather than inside it, which keeps the folder exactly what the manifest
 * describes. On Windows a process started with no `SystemRoot` cannot load its own system DLLs,
 * so that one variable is passed through; it names a public directory and leaks nothing.
 */
function minimalEnv(runtimeDir: string, extra?: Record<string, string>): Record<string, string> {
  const windows = os.platform() === "win32";
  return {
    DENO_DIR: path.join(path.dirname(runtimeDir), ".deno-cache"),
    HOME: runtimeDir,
    TMPDIR: runtimeDir,
    ...(windows ? { SystemRoot: process.env.SystemRoot ?? "C:\\Windows", TEMP: runtimeDir, TMP: runtimeDir } : {}),
    ...extra,
  };
}

export class SandboxProcess {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly lines: LineReader;
  private exited = false;

  constructor(
    runtimeDir: string,
    private readonly handlers: SandboxProcessHandlers,
    env?: Record<string, string>,
  ) {
    this.lines = createLineReader(
      {
        onLine: (line) => this.handle(line),
        onOverflow: (bytes) => {
          handlers.onResponse({ type: "log", message: `dropped ${bytes} bytes of oversized sandbox output` });
          this.kill();
        },
      },
      MAX_LINE_BYTES,
    );
    this.child = spawn(/* turbopackIgnore: true */ resolveDenoBinary(), denoArguments(runtimeDir), {
      cwd: runtimeDir,
      // Next augments ProcessEnv with a required NODE_ENV, which is about *this* process; the
      // child's environment stays exactly what minimalEnv builds.
      env: minimalEnv(runtimeDir, env) as NodeJS.ProcessEnv,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams;

    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.lines.push(chunk));
    // Deno's own errors (a bad flag, a failed permission check at startup) arrive here.
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => this.handlers.onResponse({ type: "log", message: chunk.trim() }));
    this.child.on("error", (err) => this.finish(`could not start Deno: ${err.message}`));
    this.child.on("exit", (code, signal) => this.finish(`sandbox exited (code ${code ?? "none"}, signal ${signal ?? "none"})`));
  }

  get alive(): boolean {
    return !this.exited;
  }

  send(request: SandboxRequest): void {
    if (this.exited) throw new Error("the calculator sandbox is not running");
    this.child.stdin.write(`${JSON.stringify(request)}\n`);
  }

  kill(): void {
    if (!this.exited) this.child.kill("SIGKILL");
  }

  private handle(line: string): void {
    try {
      this.handlers.onResponse(JSON.parse(line) as SandboxResponse);
    } catch {
      this.handlers.onResponse({ type: "log", message: `unparsable sandbox output: ${line.slice(0, 200)}` });
    }
  }

  private finish(reason: string): void {
    if (this.exited) return;
    this.exited = true;
    this.handlers.onExit(reason);
  }
}
