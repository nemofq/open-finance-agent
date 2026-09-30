import type { LlmProviderType } from "@/lib/config/schema";
import type { ResolutionCode } from "@/lib/llm";

/**
 * A turn refused before it started because the configuration cannot serve it: the chat's model
 * is unavailable, or it cannot read the images sent. The chat route answers it with a 400 and the
 * `code`, before the stream opens.
 */
export class AgentConfigError extends Error {
  constructor(
    message: string,
    readonly code: ResolutionCode | "images_unsupported",
  ) {
    super(message);
    this.name = "AgentConfigError";
  }
}

/**
 * Why the turn was refused, and what the user can do about it. An endpoint's models are described
 * by hand, so the answer may be a switch they can flip; OpenRouter's catalog is the provider's own
 * and cannot be argued with, so the answer there is another model.
 */
export function imagesUnsupportedMessage(provider: LlmProviderType, model: string): string {
  return provider === "openai-compatible"
    ? `${model} is not set up to accept images. Turn on Images for it in Settings › LLM, or start a chat on a model that accepts them.`
    : `${model} does not accept images. Start a chat on a model that does.`;
}
