import { randomUUID } from "node:crypto";
import type { SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { LlmProviderType } from "./provider-types";

/**
 * OpenCode routes each request by its `x-opencode-session` header and refuses one without it
 * ("Request is missing x-opencode-session"). pi adds the header from `sessionId`, which only a chat
 * turn sets; Validate, Test, titles, compaction and mapping assistance would go without.
 */
const OPENCODE_TYPES: ReadonlySet<LlmProviderType> = new Set(["opencode", "opencode-go"]);

/** OpenCode Zen or Go, whose catalogs list free promotional models next to the plan's priced ones. */
export function isOpenCode(type: LlmProviderType): boolean {
  return OPENCODE_TYPES.has(type);
}

/**
 * The session an OpenCode request is sent under: the one it already names, else the chat it belongs
 * to, else a fresh one. Other providers are left alone, because their wire APIs turn `sessionId` into
 * prompt-cache keys, affinity headers and (Codex) a reused WebSocket, which a one-off request sharing
 * the chat's id must not disturb.
 */
export function openCodeOptions<T extends SimpleStreamOptions>(type: LlmProviderType, options: T, conversationId?: string): T {
  if (!isOpenCode(type)) return options;
  return { ...options, sessionId: options.sessionId ?? conversationId ?? randomUUID() };
}
