import { Chat } from "@/components/chat/chat";
import { hasDataConnection } from "@/lib/agent/modules";

// The static segment wins over `/chat/[id]`, so "new" is never read as a session id.
export const dynamic = "force-dynamic";

/** A blank chat. The session is written on the first send, so history stays free of empties. */
export default function NewChatPage() {
  return <Chat session={null} hasDataProvider={hasDataConnection()} />;
}
