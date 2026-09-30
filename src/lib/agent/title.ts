import type { AppConfig, ModelRef } from "@/lib/config/schema";
import { resolveModel } from "@/lib/llm";
import { streamModel } from "@/lib/llm/stream";
import { cleanTitle, titlePrompt, type TitlePromptInput } from "@/lib/sessions/title";
import { blockText } from "@/lib/text/blocks";
import { errorMessage } from "@/lib/utils";
import type { SseEvent } from "./events";
import type { TurnStore } from "./turn-types";

/**
 * The title the chat's own model writes on the first turn. Best-effort: a failure leaves the
 * heuristic title the turn already saved, so `generateTitle` never throws.
 */

/**
 * Generous for six words, because a reasoning model spends nearly all of it thinking first and
 * a budget that runs out mid-thought returns no title at all (measured: ~1,000 thinking tokens
 * for a six-word answer). A title is one short call either way.
 */
const MAX_TOKENS = 1_024;
const TIMEOUT_MS = 20_000;

export interface GenerateTitleInput extends TitlePromptInput {
  config: AppConfig;
  /** The model the chat is pinned to, so the title costs nothing the chat itself would not. */
  model: ModelRef;
  timeoutMs?: number;
}

/** Ask the chat's model for a title. Returns `null` on any failure, having logged it once. */
export async function generateTitle(input: GenerateTitleInput): Promise<string | null> {
  const { config, model, timeoutMs = TIMEOUT_MS, ...prompt } = input;
  try {
    const resolved = await resolveModel(config, model, { heldBy: "chat" });
    if (!resolved.ok) {
      console.warn(`[titles] model unavailable: ${resolved.message}`);
      return null;
    }
    const reply = await streamModel(config, resolved.model, titlePrompt(prompt), {
      maxTokens: MAX_TOKENS,
      // No `reasoning`: pi's stream options have no "off" level, and leaving the option out is
      // how the agent loop itself expresses off — the adapter then sends no reasoning effort,
      // which is as far as a provider-neutral call can go. A model that thinks anyway is paid
      // for out of `MAX_TOKENS`.
      timeoutMs,
    }).result();
    if (reply.stopReason === "error") {
      console.warn(`[titles] ${reply.errorMessage || "the model returned an error"}`);
      return null;
    }
    const text = blockText(reply.content, "");
    const title = cleanTitle(text);
    // Usually a reasoning model that spent the whole budget thinking; the heuristic title stands.
    if (!title) console.warn(`[titles] no title in the reply (stopped: ${reply.stopReason})`);
    return title;
  } catch (err) {
    console.warn(`[titles] ${errorMessage(err)}`);
    return null;
  }
}

export interface TitleTask {
  store: TurnStore;
  sessionId: string;
  generate: () => Promise<string | null>;
  sink?: (event: SseEvent) => void;
  /** Serialises the write against the turn's own persists, which are read-modify-write too. */
  queue: <T>(job: () => Promise<T>) => Promise<T>;
}

/** Write the model's title and announce it. */
export async function writeGeneratedTitle({ store, sessionId, generate, sink, queue }: TitleTask): Promise<void> {
  const title = await generate();
  if (!title) return;
  await queue(() => store.update(sessionId, { title, titleSource: "generated" }));
  sink?.({ type: "title", title });
}
