import type { Api, Model, Models, Provider } from "@earendil-works/pi-ai";
import type { LlmProviderConfig, LlmProviderType, ModelRef, ThinkingLevel } from "@/lib/config/schema";

export interface LlmModelInfo {
  id: string;
  name: string;
  /** 0 when unknown. */
  contextLength: number;
  /** USD per million tokens; 0 when unknown or free. */
  pricing: { input: number; output: number };
  supportsReasoning: boolean;
  /**
   * The thinking levels the model accepts, from pi-ai's `getSupportedThinkingLevels` on the model a
   * request is built from; any other level is clamped to the nearest of these. Computed on the
   * server, so the browser never loads a pi catalog; absent where no pi model was built.
   */
  thinkingLevels?: ThinkingLevel[];
  /** Accepts image input. Sets `Model.input`; without it pi-ai silently replaces images with a placeholder. */
  supportsImages: boolean;
  /** Output token cap sent with each request; `toPiModel` falls back to 16,384 when unset. */
  maxTokens?: number;
}

/** One configured provider's models, as the model pickers show them. */
export interface ProviderModels {
  /** Provider instance id, as used in `ModelRef.provider`. */
  provider: string;
  name: string;
  type: LlmProviderType;
  models: LlmModelInfo[];
  /** Why the models could not be loaded (bad key, endpoint down), or what the provider is waiting for. */
  error?: string;
  /**
   * Set when `error` is only a missing credential rather than a failure: the provider needs a key,
   * or a sign-in that has gone. `models` may still be listed in the second case.
   */
  authGap?: "missing_key" | "reauth_required";
}

/** `GET /api/settings/llm/models`. */
export interface LlmModelsResponse {
  defaultModel: ModelRef | null;
  providers: ProviderModels[];
}

/** `POST /api/settings/llm/validate`. */
export interface ProviderValidation {
  ok: boolean;
  /** One-line summary on success, e.g. "Key “dev” · $1.20 used, no limit" or "Reachable · 2 models listed". */
  message?: string;
  error?: string;
  /** What the provider reports: OpenRouter's tool-capable catalog, or the models an endpoint lists at `/models`. */
  models?: LlmModelInfo[];
}

/** `POST /api/settings/llm/test`. */
export interface ModelTestResult {
  ok: boolean;
  latencyMs: number;
  reply: string;
  error?: string;
  /**
   * The second request, sent only for a model flagged as accepting images and only once the text
   * request passed: it asks the model to read a word off a picture, which is the one thing that
   * distinguishes seeing an image from an endpoint that quietly dropped it.
   */
  images?: { ok: boolean; latencyMs: number; reply: string; error?: string };
  /**
   * For an endpoint model marked for reasoning: one request at Off and one at `level`, and whether
   * the reasoning tokens reported show thinking switching (none at Off, some at the level). An
   * endpoint that reports no reasoning tokens cannot be verified, which is not `ok`.
   */
  thinking?: {
    ok: boolean;
    message: string;
    level: Exclude<ThinkingLevel, "off">;
    offReasoningTokens: number;
    onReasoningTokens: number;
  };
}

/** Server-side implementation of one provider type; see `src/lib/llm/providers`. */
export interface LlmProviderDefinition<C extends LlmProviderConfig = LlmProviderConfig> {
  /** The pi provider registered under `config.id`: its auth, its base URL and whatever catalog it knows up front. */
  toPiProvider(config: C): Provider;
  /** Check the key and endpoint without spending tokens. `models` is the pi-ai runtime from `src/lib/llm/models.ts`. */
  validate(config: C, models: Models): Promise<ProviderValidation>;
  /** The models a user may pick for this provider. Throws when they cannot be loaded. */
  listModels(config: C, models: Models): Promise<LlmModelInfo[]>;
  /**
   * The models this provider is known to offer without asking it anything — pi's static catalog.
   * Only a type that can be configured but not yet authenticated needs one, so that a sign-in it is
   * waiting on does not read as a model that has gone missing.
   */
  catalogModels?(config: C): LlmModelInfo[];
  /** Build a pi-ai model on the fly, from the entry the user picked. */
  toPiModel(config: C, info: LlmModelInfo): Model<Api>;
}
