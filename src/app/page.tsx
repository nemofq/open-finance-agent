import { redirect } from "next/navigation";
import { listSessions } from "@/lib/sessions/store";

// Sessions live on disk and are created on demand; never prerender this route.
export const dynamic = "force-dynamic";

/** Land on the most recent session that has any messages, or on a blank chat when none has. */
export default async function Home() {
  const sessions = await listSessions();
  const newest = sessions.find((session) => session.messageCount > 0);
  redirect(newest ? `/chat/${newest.id}` : "/chat/new");
}
