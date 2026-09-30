import { describe, expect, it, vi } from "vitest";
import type { SseEvent } from "@/lib/agent/events";
import { pumpSse, readSse, subscribeToRun } from "./sse-transport";

const encoder = new TextEncoder();
const frame = (event: SseEvent) => `data: ${JSON.stringify(event)}\n\n`;

/** A body the test feeds by hand; aborting `signal` errors it the way a fetch body does. */
function controlledBody(signal?: AbortSignal) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start: (c) => {
      controller = c;
    },
    cancel,
  });
  signal?.addEventListener("abort", () => controller.error(new DOMException("The operation was aborted.", "AbortError")));
  return {
    body,
    cancel,
    push: (text: string) => controller.enqueue(encoder.encode(text)),
    pushBytes: (bytes: Uint8Array) => controller.enqueue(bytes),
    close: () => controller.close(),
    fail: (error: Error) => controller.error(error),
  };
}

/** A body that yields the given chunks and then ends. */
function bodyOf(chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      controller.close();
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  for await (const event of readSse(body)) events.push(event);
  return events;
}

/** Let pending promise callbacks run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("readSse", () => {
  it("reads one event per frame, in order", async () => {
    const events: SseEvent[] = [{ type: "message_start" }, { type: "text_delta", delta: "Hi" }, { type: "done" }];
    expect(await collect(bodyOf([events.map(frame).join("")]))).toEqual(events);
  });

  it("reassembles frames split across chunks at any point", async () => {
    const events: SseEvent[] = [
      { type: "text_delta", delta: "Revenue grew" },
      { type: "title", title: "Quarterly review" },
      { type: "done" },
    ];
    const wire = events.map(frame).join("");
    for (let cut = 1; cut < wire.length; cut += 7) {
      expect(await collect(bodyOf([wire.slice(0, cut), wire.slice(cut)]))).toEqual(events);
    }
    // One byte at a time is the worst case of the same thing.
    expect(await collect(bodyOf(wire.split("")))).toEqual(events);
  });

  it("waits for the rest of a frame whose JSON stops mid-value", async () => {
    const source = controlledBody();
    const reader = readSse(source.body);
    const next = reader.next();
    source.push('data: {"type":"text_delta","del');
    await settle();
    source.push('ta":"partial"}\n');
    await settle();
    source.push("\n");
    expect(await next).toEqual({ done: false, value: { type: "text_delta", delta: "partial" } });
    source.close();
    expect(await reader.next()).toEqual({ done: true, value: undefined });
  });

  it("keeps a multi-byte character whole when a chunk boundary splits it", async () => {
    const bytes = encoder.encode(frame({ type: "text_delta", delta: "€ and 日本" }));
    const euro = bytes.indexOf(0xe2);
    const events = await collect(bodyOf([bytes.slice(0, euro + 1), bytes.slice(euro + 1)]));
    expect(events).toEqual([{ type: "text_delta", delta: "€ and 日本" }]);
  });

  it("skips frames without a data line, such as comments and keep-alives", async () => {
    const events = await collect(bodyOf([": keep-alive\n\n", "event: ping\n\n", frame({ type: "done" })]));
    expect(events).toEqual([{ type: "done" }]);
  });

  it("ends when the server closes the stream, dropping an unterminated tail", async () => {
    const events = await collect(bodyOf([frame({ type: "done" }), 'data: {"type":"text_delta"']));
    expect(events).toEqual([{ type: "done" }]);
  });

  it("delivers an error event like any other, and fails on a malformed frame", async () => {
    expect(await collect(bodyOf([frame({ type: "error", message: "Model unavailable" })]))).toEqual([
      { type: "error", message: "Model unavailable" },
    ]);
    await expect(collect(bodyOf(["data: {not json}\n\n"]))).rejects.toThrow(SyntaxError);
  });

  it("fails when the connection breaks mid-stream", async () => {
    const source = controlledBody();
    const events = collect(source.body);
    source.push(frame({ type: "message_start" }));
    await settle();
    source.fail(new TypeError("network error"));
    await expect(events).rejects.toThrow("network error");
  });

  it("cancels the body when the reader stops early", async () => {
    const source = controlledBody();
    source.push(frame({ type: "message_start" }) + frame({ type: "text_delta", delta: "a" }));
    for await (const event of readSse(source.body)) {
      if (event.type === "message_start") break;
    }
    expect(source.cancel).toHaveBeenCalledOnce();
  });

  it("cancels the body when a frame is malformed, rather than leaving it open", async () => {
    const source = controlledBody();
    source.push("data: {oops}\n\n");
    await expect(collect(source.body)).rejects.toThrow(SyntaxError);
    expect(source.cancel).toHaveBeenCalledOnce();
  });
});

describe("pumpSse", () => {
  it("hands every event to the consumer and resolves at the end", async () => {
    const seen: SseEvent[] = [];
    await pumpSse(bodyOf([frame({ type: "message_start" }), frame({ type: "done" })]), (event) => seen.push(event));
    expect(seen).toEqual([{ type: "message_start" }, { type: "done" }]);
  });

  it("delivers nothing after an abort, not even frames already buffered", async () => {
    const controller = new AbortController();
    const source = controlledBody(controller.signal);
    const seen: SseEvent[] = [];
    source.push([frame({ type: "text_delta", delta: "a" }), frame({ type: "text_delta", delta: "b" }), frame({ type: "done" })].join(""));
    await pumpSse(source.body, (event) => {
      seen.push(event);
      if (seen.length === 1) controller.abort();
    }, controller.signal);
    expect(seen).toEqual([{ type: "text_delta", delta: "a" }]);
  });

  it("delivers nothing after an abort even when the body itself stays readable", async () => {
    const controller = new AbortController();
    const seen: SseEvent[] = [];
    const wire = [frame({ type: "text_delta", delta: "a" }), frame({ type: "text_delta", delta: "b" }), frame({ type: "done" })];
    await pumpSse(bodyOf([wire.join("")]), (event) => {
      seen.push(event);
      if (seen.length === 1) controller.abort();
    }, controller.signal);
    expect(seen).toEqual([{ type: "text_delta", delta: "a" }]);
  });

  it("rejects with the abort when a request is cancelled mid-read", async () => {
    const controller = new AbortController();
    const source = controlledBody(controller.signal);
    const pumped = pumpSse(source.body, () => undefined, controller.signal);
    controller.abort();
    await expect(pumped).rejects.toThrow("aborted");
  });
});

describe("subscribeToRun", () => {
  /** A fetch stand-in that answers each request with the next response, honouring the abort. */
  function fakeFetch(responses: (() => Response)[]) {
    const calls: { url: string; init?: RequestInit }[] = [];
    const request = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      // The response arrives a tick later, as over a network, so an abort before then rejects.
      await Promise.resolve();
      if (init?.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
      const next = responses.shift();
      if (!next) throw new TypeError("no response left");
      return next();
    }) as unknown as typeof fetch;
    return { request, calls };
  }

  it("replays the snapshot and the buffered events, then closes as replayed", async () => {
    const controller = new AbortController();
    const events: SseEvent[] = [];
    const onClose = vi.fn();
    const wire = [
      frame({ type: "snapshot", messages: [] }),
      frame({ type: "message_start" }),
      frame({ type: "text_delta", delta: "Hello" }),
      frame({ type: "done" }),
    ];
    const { request, calls } = fakeFetch([() => new Response(bodyOf(wire))]);
    subscribeToRun("/api/sessions/s1/stream", controller.signal, { onEvent: (e) => events.push(e), onClose }, request);
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls[0]).toMatchObject({ url: "/api/sessions/s1/stream", init: { cache: "no-store", signal: controller.signal } });
    expect(events.map((event) => event.type)).toEqual(["snapshot", "message_start", "text_delta", "done"]);
    expect(onClose).toHaveBeenCalledExactlyOnceWith({ replayed: true });
  });

  it("closes with nothing replayed on a 204 or a failed request", async () => {
    for (const response of [() => new Response(null, { status: 204 }), () => new Response("gone", { status: 404 })]) {
      const onClose = vi.fn();
      const onEvent = vi.fn();
      const { request } = fakeFetch([response]);
      subscribeToRun("/stream", new AbortController().signal, { onEvent, onClose }, request);
      await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(onClose).toHaveBeenCalledExactlyOnceWith({ replayed: false });
      expect(onEvent).not.toHaveBeenCalled();
    }
    const onClose = vi.fn();
    const { request } = fakeFetch([]);
    subscribeToRun("/stream", new AbortController().signal, { onEvent: vi.fn(), onClose }, request);
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledExactlyOnceWith({ replayed: false }));
  });

  it("closes with the error when the stream breaks", async () => {
    const onClose = vi.fn();
    const { request } = fakeFetch([() => new Response(bodyOf([frame({ type: "message_start" }), "data: {oops}\n\n"]))]);
    subscribeToRun("/stream", new AbortController().signal, { onEvent: vi.fn(), onClose }, request);
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onClose.mock.calls[0][0]).toMatchObject({ replayed: true, error: expect.any(SyntaxError) });
  });

  it("goes quiet once unsubscribed, as on unmount", async () => {
    const controller = new AbortController();
    const source = controlledBody(controller.signal);
    const events: SseEvent[] = [];
    const onClose = vi.fn();
    const { request } = fakeFetch([() => new Response(source.body)]);
    subscribeToRun("/stream", controller.signal, { onEvent: (e) => events.push(e), onClose }, request);
    source.push(frame({ type: "snapshot", messages: [] }));
    await vi.waitFor(() => expect(events).toHaveLength(1));

    controller.abort();
    await settle();
    expect(() => source.push(frame({ type: "text_delta", delta: "late" }))).toThrow();
    await settle();
    expect(events).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("never calls back when unsubscribed before the response arrives", async () => {
    const controller = new AbortController();
    const onEvent = vi.fn();
    const onClose = vi.fn();
    const { request } = fakeFetch([() => new Response(bodyOf([frame({ type: "done" })]))]);
    subscribeToRun("/stream", controller.signal, { onEvent, onClose }, request);
    controller.abort();
    await settle();
    expect(onEvent).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("delivers each event once across a reconnect: the old subscription stops, the new one replays", async () => {
    const first = new AbortController();
    const source = controlledBody(first.signal);
    const second = new AbortController();
    const replay = [
      frame({ type: "snapshot", messages: [] }),
      frame({ type: "message_start" }),
      frame({ type: "text_delta", delta: "Hel" }),
      frame({ type: "text_delta", delta: "lo" }),
      frame({ type: "done" }),
    ];
    const { request } = fakeFetch([() => new Response(source.body), () => new Response(bodyOf(replay))]);
    const seen: { from: string; event: SseEvent }[] = [];
    const onClose = vi.fn();

    subscribeToRun("/stream", first.signal, { onEvent: (event) => seen.push({ from: "first", event }), onClose }, request);
    source.push(frame({ type: "snapshot", messages: [] }) + frame({ type: "message_start" }));
    source.push(frame({ type: "text_delta", delta: "Hel" }));
    await vi.waitFor(() => expect(seen).toHaveLength(3));

    // A remount: the old stream is let go of and a new one opens.
    first.abort();
    subscribeToRun("/stream", second.signal, { onEvent: (event) => seen.push({ from: "second", event }), onClose }, request);
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());

    expect(seen.filter((entry) => entry.from === "first")).toHaveLength(3);
    const replayed = seen.filter((entry) => entry.from === "second").map((entry) => entry.event);
    expect(replayed[0]).toEqual({ type: "snapshot", messages: [] });
    expect(replayed.map((event) => (event.type === "text_delta" ? event.delta : "")).join("")).toBe("Hello");
    expect(onClose).toHaveBeenCalledExactlyOnceWith({ replayed: true });
  });
});
