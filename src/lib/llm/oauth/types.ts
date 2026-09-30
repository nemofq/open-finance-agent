/**
 * The wire between a login running inside pi-ai and the connect dialog. pi's four
 * event types and four prompt types are passed through unchanged, so a provider pi adds later
 * needs no UI work. Type-only imports keep this module client-safe.
 */
import type { AuthEvent, AuthPrompt } from "@earendil-works/pi-ai";

/** `AuthPrompt.signal` is how pi cancels a prompt in-process; it has no meaning over HTTP. */
type WithoutSignal<T> = T extends unknown ? Omit<T, "signal"> : never;

/** A prompt as the dialog sees it: pi's prompt, plus the id its answer may quote back. */
export type OAuthPrompt = WithoutSignal<AuthPrompt> & { id: string };

/** One SSE frame. `done` and `error` are terminal and close the stream. */
export type OAuthStreamMessage =
  | { type: "event"; event: AuthEvent }
  | { type: "prompt"; prompt: OAuthPrompt }
  | { type: "done" }
  | { type: "error"; message: string };

/** `POST /api/settings/llm/oauth`. */
export interface OAuthStartResponse {
  id: string;
}

/** `POST /api/settings/llm/oauth/[id]/answer`. */
export interface OAuthAnswerRequest {
  value: string;
  /** The prompt being answered; an answer to a prompt that has since closed is refused. */
  promptId?: string;
}

/** One row of `GET /api/settings/llm/auth`. Never carries a key or a token. */
export interface ProviderAuthStatus {
  provider: string;
  connected: boolean;
  /** How the provider authenticates: a key from `config.json`, or a token in `auth.json`. */
  type?: "api_key" | "oauth";
  /** Unix ms the stored OAuth access token expires at; pi refreshes it on use. */
  expires?: number;
}
