import { notFound } from "next/navigation";
import { Chat } from "@/components/chat/chat";
import { missingDataConnections } from "@/lib/agent/modules";
import { getRun } from "@/lib/agent/runs";
import { getSession } from "@/lib/sessions/store";

export const dynamic = "force-dynamic";

export default async function ChatPage({ params }: PageProps<"/chat/[id]">) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) notFound();
  // A turn started before this navigation is still running on the server; the chat re-attaches
  // to its event stream rather than showing a transcript that looks finished.
  return <Chat session={session} running={getRun(id) !== undefined} missingData={missingDataConnections()} />;
}
