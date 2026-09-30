import { describe, expect, it } from "vitest";
import { checkTaskInput, checkTaskPatch } from "./validate";

const schedule = { kind: "recurring", dtStartLocal: "2026-04-02T09:00", timeZone: "UTC", rrule: "FREQ=DAILY" };
const task = { title: "T", prompt: "P", destination: { type: "chat", sessionId: "s" }, schedule };

const refusal = (checked: { ok: boolean; message?: string }): string | undefined => (checked.ok ? undefined : checked.message);

describe("checkTaskInput", () => {
  it("accepts a task that follows the contract", () => {
    expect(checkTaskInput(task)).toEqual({ ok: true, value: task });
    expect(checkTaskInput({ ...task, destination: { type: "standalone", model: { provider: "lab", model: "qwen3" } } }).ok).toBe(true);
  });

  it("names every missing field", () => {
    expect(refusal(checkTaskInput({ title: "T" }))).toBe("prompt: Required; destination: Required; schedule: Required");
    expect(refusal(checkTaskInput("text"))).toMatch(/^body: /);
  });

  it("reads a tagged union by the variant its tag names", () => {
    expect(refusal(checkTaskInput({ ...task, destination: { type: "chat" } }))).toBe("destination.sessionId: Required");
    expect(refusal(checkTaskInput({ ...task, destination: { type: "email" } }))).toBe('destination.type: must be one of "chat", "standalone"');
    expect(refusal(checkTaskInput({ ...task, destination: "chat" }))).toBe("destination: must be an object");
    expect(refusal(checkTaskInput({ ...task, schedule: { kind: "once", runAt: 5, timeZone: "UTC" } }))).toMatch(/^schedule\.runAt: /);
  });
});

describe("checkTaskPatch", () => {
  it("accepts an empty edit and refuses a status the user may not set", () => {
    expect(checkTaskPatch({}).ok).toBe(true);
    expect(refusal(checkTaskPatch({ status: "completed" }))).toBe('status: must be one of "active", "paused"');
  });
});
