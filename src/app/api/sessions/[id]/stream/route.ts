import { sseResponse } from "@/app/api/http";
import { withoutSystemMessages } from "@/lib/agent/messages";
import { getRun } from "@/lib/agent/runs";
import { encodeSse } from "@/lib/agent/sse";
import type { SseEvent } from "@/lib/agent/events";

/**
 * Re-attach to the turn a session already has in flight, for a browser that navigated away and
 * back: the transcript as the server holds it, then the events buffered since its last message,
 * then the live ones. 204 when nothing is running — the client just re-reads the session.
 *
 * Cancelling this stream only unsubscribes; the run belongs to the POST that started it.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const run = getRun((await params).id);
  if (!run) return new Response(null, { status: 204 });

  return sseResponse((write, close) => {
    // Subscribing, reading the transcript and copying the buffer happen in one synchronous
    // tick, so no event can fall between the snapshot we send and the ones we replay.
    const listener = (event: SseEvent) => {
      write(encodeSse(event));
      if (event.type === "done" || event.type === "error") close();
    };
    run.subscribers.add(listener);
    const snapshot = withoutSystemMessages(run.agent.state.messages);
    const replay = [...run.pending];

    write(encodeSse({ type: "snapshot", messages: snapshot }));
    for (const event of replay) write(encodeSse(event));
    return () => run.subscribers.delete(listener);
  });
}
