import type { SseEvent } from "@/lib/agent/events";

/**
 * Split an SSE body into wire events as they arrive. A frame ends at a blank line, so a chunk that
 * stops mid-frame (or mid-character) waits in the buffer for the rest. Leaving early, by a throw
 * or a consumer that stops reading, cancels the body so the connection is not left open.
 */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = frame.split("\n").find((line) => line.startsWith("data: "));
        if (data) yield JSON.parse(data.slice(6)) as SseEvent;
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    // A no-op on a stream that finished; one that failed or was aborted rejects, which is fine.
    reader.cancel().catch(() => undefined);
  }
}

/**
 * Hand one turn's events to `onEvent` in order, until the server closes the stream. Once `signal`
 * is aborted nothing more is delivered, not even frames already buffered, so a stream the chat has
 * let go of never writes into it again.
 */
export async function pumpSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: SseEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  for await (const event of readSse(body)) {
    if (signal?.aborted) return;
    onEvent(event);
  }
}

export interface RunStreamHandlers {
  onEvent: (event: SseEvent) => void;
  /**
   * Called once when the stream ends by itself, never after `signal` is aborted. `replayed` says
   * whether there was a live stream to read; `error` is what broke it, if anything did.
   */
  onClose: (result: { replayed: boolean; error?: unknown }) => void | Promise<void>;
}

/**
 * Re-attach to a turn that was already running when the page loaded. The server answers with a
 * `snapshot` of its transcript and replays what has streamed since, then the live tail. A 204 says
 * the run ended in between, and a failed request is no reason to shout either: both close with
 * nothing replayed, so the saved transcript is the story. Aborting `signal` unsubscribes.
 */
export function subscribeToRun(
  url: string,
  signal: AbortSignal,
  handlers: RunStreamHandlers,
  request: typeof fetch = fetch,
): void {
  const read = async (res: Response | null) => {
    const body = res !== null && res.ok && res.status !== 204 ? res.body : null;
    let error: unknown;
    try {
      if (body) await pumpSse(body, handlers.onEvent, signal);
    } catch (err) {
      error = err;
    }
    if (signal.aborted) return;
    await handlers.onClose(error === undefined ? { replayed: body !== null } : { replayed: body !== null, error });
  };
  request(url, { cache: "no-store", signal })
    .then(read)
    .catch(() => read(null));
}
