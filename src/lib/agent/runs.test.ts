import type { Agent } from "@earendil-works/pi-agent-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SseEvent } from "@/lib/agent/events";
import { abortRun, bindRun, endRun, getRun, releaseRun, reserveRun, RunInProgressError, startRun } from "./runs";

const SESSION = "run-registry-test";

/** The registry only ever reads `state.messages` off the agent; nothing else needs to exist. */
const agent = () => ({ state: { messages: [] } }) as unknown as Agent;

const delta = (text: string): SseEvent => ({ type: "text_delta", delta: text });
const end: SseEvent = { type: "message_end", message: { role: "user", content: "hi", timestamp: 0 } };

afterEach(() => endRun(SESSION));

describe("run registry", () => {
  it("registers a run and refuses a second one for the same session", () => {
    startRun(SESSION, agent());
    expect(getRun(SESSION)).toBeDefined();
    expect(() => startRun(SESSION, agent())).toThrow(RunInProgressError);
  });

  it("reserves a session before agent construction and binds it later", () => {
    const reservation = reserveRun(SESSION);
    expect(() => reserveRun(SESSION)).toThrow(RunInProgressError);
    bindRun(reservation, agent());
    expect(getRun(SESSION)).toBeDefined();
  });

  it("releases an unused reservation after an agent build fails", () => {
    const reservation = reserveRun(SESSION);
    releaseRun(reservation);
    const again = reserveRun(SESSION);
    expect(again).toBeDefined();
    releaseRun(again);
  });

  it("forgets the run once it ends", () => {
    startRun(SESSION, agent());
    endRun(SESSION);
    expect(getRun(SESSION)).toBeUndefined();
  });

  it("buffers published events for a reader that has not attached yet", () => {
    const run = startRun(SESSION, agent());
    run.publish({ type: "message_start" });
    run.publish(delta("he"));
    run.publish(delta("llo"));
    expect(run.pending).toEqual([{ type: "message_start" }, delta("he"), delta("llo")]);
  });

  it("drops the buffer at a message boundary, since that message is on the transcript", () => {
    const run = startRun(SESSION, agent());
    run.publish(delta("he"));
    run.publish(end);
    expect(run.pending).toEqual([]);
    run.publish({ type: "tool_call_start", id: "t1", name: "quote", args: {} });
    expect(run.pending).toHaveLength(1);
  });

  it("fans out to subscribers, including the terminal event", () => {
    const run = startRun(SESSION, agent());
    const seen: SseEvent[] = [];
    run.subscribers.add((event) => seen.push(event));
    run.publish(delta("hi"));
    run.publish({ type: "done" });
    expect(seen).toEqual([delta("hi"), { type: "done" }]);
  });

  it("clears subscribers when the run ends", () => {
    const run = startRun(SESSION, agent());
    run.subscribers.add(() => undefined);
    endRun(SESSION);
    expect(run.subscribers.size).toBe(0);
  });

  it("stops buffering deltas past the cap but keeps the structural events", () => {
    const run = startRun(SESSION, agent());
    for (let index = 0; index < 20_050; index += 1) run.publish(delta("x"));
    expect(run.pending).toHaveLength(20_000);
    run.publish({ type: "tool_call_start", id: "t1", name: "quote", args: {} });
    expect(run.pending.at(-1)).toEqual({ type: "tool_call_start", id: "t1", name: "quote", args: {} });
  });

  it("aborts the agent, tells its readers it is done and frees the session", () => {
    const abort = vi.fn();
    const run = startRun(SESSION, { state: { messages: [] }, abort } as unknown as Agent);
    const seen: SseEvent[] = [];
    run.subscribers.add((event) => seen.push(event));

    expect(abortRun(SESSION)).toBe(true);
    expect(abort).toHaveBeenCalledOnce();
    expect(seen).toEqual([{ type: "done" }]);
    expect(getRun(SESSION)).toBeUndefined();
    expect(abortRun(SESSION)).toBe(false);
  });

  it("keeps a reservation across a module reload, as it does a run", async () => {
    const reservation = reserveRun(SESSION);
    vi.resetModules();
    const reloaded = await import("./runs");
    expect(() => reloaded.reserveRun(SESSION)).toThrow(reloaded.RunInProgressError);
    reloaded.bindRun(reservation, agent());
    expect(getRun(SESSION)).toBe(reloaded.getRun(SESSION));
  });
});
