/**
 * What a provider card says about a sign-in provider's credential, derived from
 * `GET /api/settings/llm/auth`. Only sign-in instances have one; a key instance shows its key field
 * instead. Tokens never reach the browser, so this is the whole of what the client knows.
 */
import type { LlmProviderConfig } from "@/lib/config/schema";
import { catalogEntries, type LlmCatalogEntry, providerAuthKind } from "@/lib/llm/catalog";
import type { ProviderAuthStatus } from "@/lib/llm/oauth/types";

export type ConnectionStatus =
  /** A key instance: the card shows the key field and nothing about a connection. */
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "failed"; error: string }
  /** `renewsAt` is when the access token lapses; pi renews it on the next request, so this is not an error. */
  | { kind: "connected"; renewsAt?: number }
  | { kind: "disconnected" };

/** Whether this instance signs in rather than carrying a key. */
export function signsIn(provider: LlmProviderConfig): boolean {
  return providerAuthKind(provider) === "oauth";
}

/**
 * The catalog row this instance was added by, so a card describes it as the dialog did: a Claude
 * subscription is not the same product as an Anthropic key, though both are the `anthropic` type.
 */
export function catalogEntryFor(provider: LlmProviderConfig): LlmCatalogEntry | undefined {
  const auth = providerAuthKind(provider);
  return catalogEntries.find((entry) => entry.type === provider.type && entry.auth === auth);
}

export interface AuthStatusState {
  rows: ProviderAuthStatus[] | null;
  error: string | null;
}

/** Where a provider's sign-in stands. A row that reports an API key counts as no connection to show. */
export function connectionStatus(provider: LlmProviderConfig, status: AuthStatusState): ConnectionStatus {
  if (!signsIn(provider)) return { kind: "none" };
  if (status.rows === null) return status.error ? { kind: "failed", error: status.error } : { kind: "loading" };
  const row = status.rows.find((entry) => entry.provider === provider.id);
  if (!row?.connected || row.type !== "oauth") return { kind: "disconnected" };
  return { kind: "connected", ...(row.expires ? { renewsAt: row.expires } : {}) };
}

/** The action the connect button offers, which is also its label. */
export function connectAction(status: ConnectionStatus): "Connect" | "Reconnect" {
  return status.kind === "connected" ? "Reconnect" : "Connect";
}

/** Whether the user has to sign in before this provider can answer: shown as the card's warning. */
export function needsConnecting(status: ConnectionStatus): boolean {
  return status.kind === "disconnected";
}
