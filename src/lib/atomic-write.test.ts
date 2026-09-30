import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFileAtomic, writeFileAtomicSync } from "./atomic-write";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ofa-atomic-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("writeFileAtomic", () => {
  it("writes the file with the mode asked for and leaves nothing else behind", async () => {
    const file = path.join(dir, "secret.json");
    await writeFileAtomic(file, "{}\n", { mode: 0o600 });
    expect(readFileSync(file, "utf8")).toBe("{}\n");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir)).toEqual(["secret.json"]);
  });

  it("replaces a file with a wider mode by one with the mode asked for", async () => {
    const file = path.join(dir, "secret.json");
    writeFileSync(file, "old", { mode: 0o644 });
    await writeFileAtomic(file, "new", { mode: 0o600 });
    expect(readFileSync(file, "utf8")).toBe("new");
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("lets one process write the same file many times at once", async () => {
    const file = path.join(dir, "busy.json");
    const payloads = Array.from({ length: 20 }, (_, index) => JSON.stringify({ index, pad: "x".repeat(10_000) }));
    await Promise.all(payloads.map((payload) => writeFileAtomic(file, payload)));
    expect(payloads).toContain(readFileSync(file, "utf8"));
    expect(readdirSync(dir)).toEqual(["busy.json"]);
  });

  it("removes its temporary file when the rename fails", async () => {
    const target = path.join(dir, "occupied");
    mkdirSync(path.join(target, "child"), { recursive: true });
    await expect(writeFileAtomic(target, "data")).rejects.toThrow();
    expect(readdirSync(dir)).toEqual(["occupied"]);
  });
});

describe("writeFileAtomicSync", () => {
  it("writes the file with the mode asked for and leaves nothing else behind", () => {
    const file = path.join(dir, "config.json");
    writeFileAtomicSync(file, "{}\n", { mode: 0o600 });
    expect(readFileSync(file, "utf8")).toBe("{}\n");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir)).toEqual(["config.json"]);
  });

  it("removes its temporary file when the rename fails", () => {
    const target = path.join(dir, "occupied");
    mkdirSync(path.join(target, "child"), { recursive: true });
    expect(() => writeFileAtomicSync(target, "data")).toThrow();
    expect(readdirSync(dir)).toEqual(["occupied"]);
  });
});
