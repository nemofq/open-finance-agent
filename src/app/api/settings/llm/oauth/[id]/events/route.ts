import { loginSessions } from "@/lib/llm/oauth/sessions";
import type { OAuthStreamMessage } from "@/lib/llm/oauth/types";
import { jsonError, sseResponse } from "@/app/api/http";

/** A device-code login idles for minutes; a comment frame keeps the connection from being dropped. */
const HEARTBEAT_MS = 15_000;

type Context = { params: Promise<{ id: string }> };

/**
 * Everything the login has said, then everything it says next, then the terminal message, which
 * closes the stream. A dialog that reconnects gets the whole story from the queue, in order.
 */
export async function GET(_request: Request, { params }: Context): Promise<Response> {
  const sessions = loginSessions();
  const id = (await params).id;
  if (!sessions.has(id)) return jsonError("Sign-in not found", 404);

  return sseResponse((write, close) => {
    const listener = (message: OAuthStreamMessage) => {
      write(`data: ${JSON.stringify(message)}\n\n`);
      if (message.type === "done" || message.type === "error") close();
    };

    const subscription = sessions.subscribe(id, listener);
    if (!subscription) {
      // Gone between the check above and here; the dialog re-reads the provider's status.
      close();
      return;
    }
    const heartbeat = setInterval(() => write(":\n\n"), HEARTBEAT_MS);
    for (const message of subscription.replay) listener(message);
    return () => {
      subscription.unsubscribe();
      clearInterval(heartbeat);
    };
  });
}
