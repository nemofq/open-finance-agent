import { afterEach, describe, expect, it, vi } from "vitest";
import { processSingleton, resetProcessSingletons, runSerially } from "./process-state";

afterEach(() => {
  resetProcessSingletons("test.counter");
  vi.resetModules();
});

describe("processSingleton", () => {
  it("creates the value once and hands the same one back", () => {
    const create = vi.fn(() => ({ count: 0 }));
    const first = processSingleton("test.counter", create);
    first.count += 1;
    expect(processSingleton("test.counter", create)).toBe(first);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("is shared by a second copy of the module, as Next loads one per bundle", async () => {
    const value = processSingleton("test.counter", () => ({ count: 1 }));
    vi.resetModules();
    const copy = await import("./process-state");
    expect(copy.processSingleton("test.counter", () => ({ count: 2 }))).toBe(value);
  });

  it("creates a fresh value after a reset", () => {
    const first = processSingleton("test.counter", () => ({ count: 0 }));
    resetProcessSingletons("test.counter");
    expect(processSingleton("test.counter", () => ({ count: 0 }))).not.toBe(first);
  });
});

describe("runSerially", () => {
  it("runs tasks under one key one at a time, in the order they were queued", async () => {
    const events: string[] = [];
    const task = (name: string, ms: number) => async () => {
      events.push(`${name} start`);
      await new Promise((resolve) => setTimeout(resolve, ms));
      events.push(`${name} end`);
      return name;
    };
    const results = await Promise.all([runSerially("k", task("a", 20)), runSerially("k", task("b", 1))]);
    expect(results).toEqual(["a", "b"]);
    expect(events).toEqual(["a start", "a end", "b start", "b end"]);
  });

  it("orders tasks queued through another copy of the module", async () => {
    vi.resetModules();
    const copy = await import("./process-state");
    const events: string[] = [];
    const slow = runSerially("shared", async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      events.push("first");
    });
    const fast = copy.runSerially("shared", async () => {
      events.push("second");
    });
    await Promise.all([slow, fast]);
    expect(events).toEqual(["first", "second"]);
  });

  it("keeps going after a task fails, and lets tasks under other keys run alongside", async () => {
    const failed = runSerially("x", async () => {
      throw new Error("boom");
    });
    await expect(failed).rejects.toThrow("boom");
    await expect(runSerially("x", async () => "after")).resolves.toBe("after");

    let release = () => {};
    const blocked = runSerially("y", () => new Promise<void>((resolve) => (release = resolve)));
    await expect(runSerially("z", async () => "free")).resolves.toBe("free");
    release();
    await blocked;
  });
});
