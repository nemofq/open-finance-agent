"use client";

import { useJson } from "@/components/shared/use-json";
import type { ProviderAuthStatus } from "@/lib/llm/oauth/types";
import type { AuthStatusState } from "./connection";

export interface AuthStatus extends AuthStatusState {
  /** Fetch again, after a sign-in, a disconnect or a deleted provider. */
  reload: () => Promise<void>;
}

/** Which providers are signed in, for the provider cards. Never carries a token, only its state. */
export function useAuthStatus(): AuthStatus {
  const { data, error, reload } = useJson<ProviderAuthStatus[]>("/api/settings/llm/auth");
  // A failed read shows as failed on the cards rather than as the last answer.
  return { rows: error ? null : data, error, reload };
}
