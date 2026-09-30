import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, it, vi } from "vitest";
import type { SseEvent } from "@/lib/agent/events";
import type { ContextUsage } from "@/lib/context/types";
import type { CheckRecord } from "@/lib/policy/types";
import { createLiveTurn, releasePreviews } from "./live-turn";
import { pumpSse } from "./sse-transport";
import type { MessagePart, ToolOutcome } from "./transcript";
import type { WorkPhase } from "./working-indicator";

/** The chat's state as the sink's setters leave it, applied at once as React would on render. */
function harness(initial: AgentMessage[] = []) {
  const state = {
    messages: initial,
    live: [] as MessagePart[],
    outcomes: {} as Record<string, ToolOutcome>,
    phase: { kind: "working" } as WorkPhase,
    context: null as ContextUsage | null,
    error: null as string | null,
    title: null as string | null,
    opened: [] as string[],
  };
  let clock = 1_000;
  const turn = createLiveTurn(
    {
      setMessages: (update) => (state.messages = update(state.messages)),
      setLive: (update) => (state.live = update(state.live)),
      setToolOutcomes: (update) => (state.outcomes = update(state.outcomes)),
      setPhase: (phase) => (state.phase = phase),
      setContext: (usage) => (state.context = usage),
      setError: (message) => (state.error = message),
      setTitle: (title) => (state.title = title),
      openReport: (id) => state.opened.push(id),
    },
    () => clock,
  );
  const apply = (...events: SseEvent[]) => events.forEach(turn.apply);
  return { state, turn, apply, tick: (ms: number) => (clock += ms) };
}

/** A response body carrying `events` as SSE frames, all in one chunk. */
function bodyOf(events: SseEvent[]): ReadableStream<Uint8Array> {
  const wire = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(wire));
      controller.close();
    },
  });
}

const user = (text: string): AgentMessage => ({ role: "user", content: text, timestamp: 1 });
const assistant = (text: string) =>
  ({
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-completions",
    provider: "stub",
    model: "stub",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp: 2,
  }) as AgentMessage;
const check = (id: string, kind: CheckRecord["kind"], enforced: boolean): CheckRecord => ({
  id,
  rule: "P8",
  kind,
  reason: "",
  stage: "before_stop",
  mode: "enforce",
  enforced,
  timestamp: 3,
});

describe("createLiveTurn", () => {
  it("streams text into the live parts and says what the turn is doing", () => {
    const { state, apply } = harness();
    apply({ type: "message_start" }, { type: "text_delta", delta: "Rev" }, { type: "text_delta", delta: "enue" });
    expect(state.live).toEqual([{ kind: "text", text: "Revenue" }]);
    expect(state.phase).toEqual({ kind: "writing" });
  });

  it("times a thinking span from its first delta to whatever follows it", () => {
    const { state, apply, tick } = harness();
    apply({ type: "thinking_delta", delta: "Consider" });
    expect(state.phase).toEqual({ kind: "thinking" });
    tick(2_500);
    apply({ type: "thinking_delta", delta: " margins" });
    tick(500);
    apply({ type: "text_delta", delta: "Answer" });
    expect(state.live).toEqual([
      { kind: "thinking", text: "Consider margins", durationMs: 3_000 },
      { kind: "text", text: "Answer" },
    ]);
  });

  it("swaps the optimistic user turn for the server's echo and appends the agent's messages", () => {
    const { state, apply } = harness([user("draft")]);
    apply({ type: "message_end", message: user("saved") });
    apply({ type: "message_start" }, { type: "text_delta", delta: "Done" }, { type: "message_end", message: assistant("Done") });
    expect(state.messages).toEqual([user("saved"), assistant("Done")]);
    expect(state.live).toEqual([]);
    expect(state.phase).toEqual({ kind: "working" });
  });

  it("releases the previews of an accepted turn that a Stop cut off before its echo landed", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    try {
      const { state, turn } = harness([user("draft")]);
      turn.begin();
      // The echo is already buffered behind the first frame when Stop aborts the send.
      const controller = new AbortController();
      const wire = [{ type: "message_start" }, { type: "message_end", message: user("saved") }] satisfies SseEvent[];
      await pumpSse(bodyOf(wire), (event) => {
        turn.apply(event);
        controller.abort();
      }, controller.signal);
      turn.finish();
      expect(state.messages).toEqual([user("draft")]);
      releasePreviews([{ previewUrl: "blob:one" }, { previewUrl: "blob:two" }], true);
      expect(revoke.mock.calls).toEqual([["blob:one"], ["blob:two"]]);
    } finally {
      revoke.mockRestore();
    }
  });

  it("keeps the previews of a refused send for its Retry bubble", () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    try {
      releasePreviews([{ previewUrl: "blob:one" }], false);
      expect(revoke).not.toHaveBeenCalled();
    } finally {
      revoke.mockRestore();
    }
  });

  it("opens a report when its call ends well, and no other tool's", () => {
    const { state, apply } = harness();
    apply(
      { type: "tool_call_pending", name: "create_report" },
      { type: "tool_call_start", id: "r1", name: "create_report", args: {} },
      { type: "tool_call_start", id: "q1", name: "quote", args: {} },
      { type: "tool_call_end", id: "q1", result: "ok", isError: false },
      { type: "tool_call_start", id: "r2", name: "create_report", args: {} },
      { type: "tool_call_end", id: "r2", result: "rejected", isError: true },
    );
    expect(state.opened).toEqual([]);
    expect(state.phase).toEqual({ kind: "working" });
    apply({ type: "tool_call_end", id: "r1", result: "ok", isError: false });
    expect(state.opened).toEqual(["r1"]);
    expect(state.outcomes).toEqual({
      q1: { result: "ok", isError: false },
      r1: { result: "ok", isError: false },
      r2: { result: "rejected", isError: true },
    });
  });

  it("names the phase from a pending call once its name is known", () => {
    const { state, apply } = harness();
    apply({ type: "tool_call_pending", name: "" });
    expect(state.phase).toEqual({ kind: "working" });
    apply({ type: "tool_call_pending", name: "create_report" });
    expect(state.phase).toEqual({ kind: "drafting" });
    apply({ type: "tool_call_pending", name: "edgar_search" });
    expect(state.phase).toEqual({ kind: "calling", tool: "edgar_search" });
  });

  it("puts an enforced follow-up on the transcript at once and holds the other checks for the end", () => {
    const { state, turn, apply } = harness([user("q")]);
    apply({ type: "check", check: check("c1", "flag", true) }, { type: "check", check: check("c2", "follow_up", true) });
    expect(state.messages.map((message) => message.role)).toEqual(["user", "check"]);
    expect(state.phase).toEqual({ kind: "revising" });
    // The follow-up is replayed as a message of its own; it is not added twice.
    apply({ type: "message_end", message: { role: "check", check: check("c2", "follow_up", true), timestamp: 3 } as AgentMessage });
    expect(state.messages).toHaveLength(2);

    turn.finish();
    expect(state.messages.flatMap((message) => (message.role === "check" ? [message.check.id] : []))).toEqual(["c2", "c1"]);
  });

  it("drops the held checks when the next message goes out", () => {
    const { state, turn, apply } = harness();
    apply({ type: "check", check: check("c1", "flag", true) });
    turn.begin();
    turn.finish();
    expect(state.messages).toEqual([]);
  });

  it("keeps the held checks when React runs the updater after finish returns", () => {
    // React may queue an updater and run it on a later render, after `finish` has moved on.
    const queued: ((current: AgentMessage[]) => AgentMessage[])[] = [];
    const noop = () => {};
    const turn = createLiveTurn({
      setMessages: (update) => queued.push(update),
      setLive: noop,
      setToolOutcomes: noop,
      setPhase: noop,
      setContext: noop,
      setError: noop,
      setTitle: noop,
      openReport: noop,
    });
    turn.apply({ type: "check", check: check("c1", "flag", true) });
    turn.finish();
    const messages = queued.reduce((current, update) => update(current), [user("q")]);
    expect(messages.flatMap((message) => (message.role === "check" ? [message.check.id] : []))).toEqual(["c1"]);
  });

  it("appends a compaction checkpoint without touching the live turn", () => {
    const { state, apply } = harness([user("q")]);
    apply({ type: "text_delta", delta: "partial" });
    const compaction = { role: "compaction", summary: "s", tokensBefore: 10, tokensAfter: 2, timestamp: 4 } as unknown as AgentMessage;
    apply({ type: "message_end", message: compaction });
    expect(state.messages).toEqual([user("q"), compaction]);
    expect(state.live).toEqual([{ kind: "text", text: "partial" }]);
  });

  it("follows the title, the context meter, a revised answer and an error", () => {
    const { state, apply } = harness([user("q"), assistant("draft {E1}")]);
    const usage = { used: 10, window: 100, compactions: 0 } as unknown as ContextUsage;
    apply(
      { type: "title", title: "Apple margins" },
      { type: "context", usage },
      { type: "answer_updated", text: "final" },
      { type: "error", message: "Model unavailable" },
      { type: "done" },
    );
    expect(state.title).toBe("Apple margins");
    expect(state.context).toBe(usage);
    expect(state.messages[1]).toMatchObject({ content: [{ type: "text", text: "final" }] });
    expect(state.error).toBe("Model unavailable");
  });

  it("rebuilds from a re-attach snapshot without doubling what streamed before it", () => {
    const { state, turn, apply } = harness([user("q")]);
    // The first connection saw part of the turn before it was dropped.
    apply(
      { type: "message_start" },
      { type: "text_delta", delta: "Hel" },
      { type: "tool_call_start", id: "t1", name: "quote", args: {} },
      { type: "check", check: check("c1", "flag", true) },
    );
    // The new connection starts with the server's transcript and replays the turn since.
    apply(
      { type: "snapshot", messages: [user("q")] },
      { type: "message_start" },
      { type: "text_delta", delta: "Hel" },
      { type: "text_delta", delta: "lo" },
      { type: "tool_call_start", id: "t1", name: "quote", args: {} },
      { type: "tool_call_end", id: "t1", result: "ok", isError: false },
      { type: "check", check: check("c1", "flag", true) },
    );
    expect(state.messages).toEqual([user("q")]);
    expect(state.live).toEqual([{ kind: "text", text: "Hello" }]);
    expect(state.outcomes).toEqual({ t1: { result: "ok", isError: false } });
    turn.finish();
    expect(state.messages.filter((message) => message.role === "check")).toHaveLength(1);
  });
});
