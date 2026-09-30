import { accessSync, constants } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { denoArguments, resolveDenoBinary } from "./process";

/**
 * The permission flags are the whole security boundary, so they get a test of their own: a
 * well-meaning change that adds `--allow-net` to make a library work must fail here first.
 */

const FORBIDDEN = [
  "--allow-net",
  "--allow-env",
  "--allow-write",
  "--allow-sys",
  "--allow-run",
  "--allow-ffi",
  "--allow-all",
  "-A",
];

describe("denoArguments", () => {
  const runtime = path.join("/tmp", "calc-1");
  const args = denoArguments(runtime);

  it("grants read access to the runtime folder and nothing else", () => {
    expect(args.filter((arg) => arg.startsWith("--allow-"))).toEqual([`--allow-read=${runtime}`]);
  });

  it("never grants a permission that would break the sandbox's promises", () => {
    for (const flag of FORBIDDEN) expect(args).not.toContain(flag);
  });

  it("runs offline, without config or lockfile, and never prompts", () => {
    expect(args).toEqual(expect.arrayContaining(["--no-prompt", "--no-remote", "--no-config", "--no-lock"]));
  });

  it("caps WebAssembly memory at 1 GiB", () => {
    expect(args).toContain("--v8-flags=--wasm-max-mem-pages=16384");
  });

  it("runs the host from the runtime folder", () => {
    expect(args.at(-1)).toBe(path.join(runtime, "host.ts"));
  });
});

describe("resolveDenoBinary", () => {
  it("finds the executable inside the installed deno package, not on PATH", () => {
    const binary = resolveDenoBinary();
    expect(binary).toContain(`${path.sep}@deno${path.sep}`);
    expect(() => accessSync(binary, constants.X_OK)).not.toThrow();
  });
});
