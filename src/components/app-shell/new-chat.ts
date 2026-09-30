"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { confirmLeave } from "@/components/shared/use-unsaved-changes";

/**
 * Opens a blank chat, after confirming any unsaved settings may be discarded. The session itself
 * is only created once a message is sent.
 */
export function useNewChat(onNavigate?: () => void): () => void {
  const router = useRouter();

  return useCallback(() => {
    if (!confirmLeave()) return;
    onNavigate?.();
    router.push("/chat/new");
  }, [onNavigate, router]);
}
