import type { KnownProvider, ModelThinkingLevel } from "@earendil-works/pi-ai";
import { z } from "zod";
import {
  type EndpointLlmProviderType,
  type HostedLlmProviderType,
  hostedLlmProviderTypes,
  llmAuthKinds,
  type LlmAuthKind,
  type LlmAuthKindOf,
  llmProviderTypeFacts,
  llmProviderTypes,
  llmProviderTypeTable,
  type LlmProviderType,
} from "@/lib/llm/provider-types";

/** The provider types live in one table beside the catalog; config readers keep importing them from here. */
export { type LlmAuthKind, type LlmProviderType, llmProviderTypes } from "@/lib/llm/provider-types";

/**
 * pi-ai's thinking levels (`ModelThinkingLevel`), in pi's order, passed through as they are: pi clamps
 * a level to the nearest one each model accepts and maps it to the model's own value per request.
 * `schema.test.ts` fails the typecheck when a pi-ai upgrade adds a level this list lacks.
 */
export const thinkingLevels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const satisfies readonly ModelThinkingLevel[];

/**
 * Provider ids never contain `/`, so `provider/model` keys (see `modelRefKey`) stay unique even
 * though model ids such as `openai/gpt-5` contain slashes.
 */
const providerIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "must be lowercase letters, digits and dashes");

/**
 * pi-ai's own provider ids. pi keys credentials by provider id, and every hosted provider type
 * is registered under the pi id of its type, so an id a user chooses
 * must stay out of this namespace. `satisfies` fails the typecheck when a pi-ai upgrade adds a
 * provider or drops one.
 */
const piBuiltinProviders = {
  "amazon-bedrock": true, "ant-ling": true, anthropic: true, azure: true,
  baseten: true, cerebras: true, "cloudflare-ai-gateway": true, "cloudflare-workers-ai": true,
  deepseek: true, fireworks: true, "github-copilot": true, google: true, "google-vertex": true,
  groq: true, huggingface: true, "kimi-coding": true, meta: true, minimax: true, "minimax-cn": true,
  mistral: true, moonshotai: true, "moonshotai-cn": true, nvidia: true, openai: true,
  "openai-codex": true, opencode: true, "opencode-go": true, openrouter: true,
  "qwen-token-plan": true, "qwen-token-plan-cn": true, "qwen-token-plan-individual": true,
  radius: true, together: true, typesafe: true, "vercel-ai-gateway": true, xai: true, xiaomi: true,
  "xiaomi-token-plan-ams": true, "xiaomi-token-plan-cn": true, "xiaomi-token-plan-sgp": true,
  zai: true, "zai-coding-cn": true,
} satisfies Record<KnownProvider, true>;

export function isPiBuiltinProviderId(id: string): boolean {
  return Object.hasOwn(piBuiltinProviders, id);
}

/** An endpoint the user adds is named by the user, so it is the one id that can collide. */
const endpointIdSchema = providerIdSchema.refine((id) => !isPiBuiltinProviderId(id), {
  error: "is reserved by a built-in provider",
});

/** One model of one configured provider. */
export const modelRefSchema = z.object({
  provider: providerIdSchema,
  model: z.string().min(1),
});

/** How an endpoint model is told not to think; see `customThinkingSchema`. */
const thinkingOffModes = ["omit", "none", "chat-template"] as const;

const levelName = z.string().trim().min(1).optional();

/**
 * How one endpoint model is told how hard to think. Chat Completions has no standard for it, so the
 * person adding the model declares it rather than the app guessing from the model's name.
 * `levels` are what the server calls each level above off, sent as `reasoning_effort`. Minimal to
 * high default to their own name; xhigh and max are offered only once named, as pi-ai offers them
 * for any model. `off` is how thinking is turned off: `omit` sends no field and leaves
 * the server's default, `none` sends `reasoning_effort: "none"`, and `chat-template` sends
 * `chat_template_kwargs: { enable_thinking: false }` (vLLM and SGLang serving Qwen, for example).
 */
const customThinkingSchema = z.object({
  levels: z
    .object({ minimal: levelName, low: levelName, medium: levelName, high: levelName, xhigh: levelName, max: levelName })
    .optional(),
  off: z.enum(thinkingOffModes).optional(),
});

/** A model listed by hand for an endpoint with no catalog; unknown limits are left unset. */
export const customModelSchema = z.object({
  id: z.string().trim().min(1),
  /** Display name; the id is shown when unset. */
  name: z.string().trim().min(1).optional(),
  contextWindow: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
  /** Whether the model accepts a reasoning effort, so the thinking level applies to it. */
  reasoning: z.boolean().optional(),
  /** What this server calls each thinking level and how it turns thinking off; applies only with `reasoning`. */
  thinking: customThinkingSchema.optional(),
  /** Whether the model accepts image input; off, the composer refuses attachments for it. */
  images: z.boolean().optional(),
});

const providerBase = {
  id: providerIdSchema,
  name: z.string().trim().min(1),
  /** May be omitted or empty: an instance that signs in has no key, and neither do some endpoints. */
  apiKey: z.string().default(""),
};

/** Absent means a key, which is what every instance saved before config v3 used. */
const apiKeyAuth = z.literal("api_key").optional();
const oauthAuth = z.literal("oauth");
const eitherAuth = z.enum(llmAuthKinds).optional();

/** The `auth` field for a type offering `K`: a sign-in-only type never had a key, so it cannot be absent. */
type AuthSchema<K extends LlmAuthKind> = [K] extends ["oauth"]
  ? typeof oauthAuth
  : [K] extends ["api_key"]
    ? typeof apiKeyAuth
    : typeof eitherAuth;

function authSchema<K extends LlmAuthKind>(kinds: readonly K[]): AuthSchema<K> {
  const offered: readonly LlmAuthKind[] = kinds;
  if (!offered.includes("api_key")) return oauthAuth as AuthSchema<K>;
  return (offered.includes("oauth") ? eitherAuth : apiKeyAuth) as AuthSchema<K>;
}

/**
 * What a key instance holds besides its key, for a type whose row has a `setup`: which of the row's
 * methods it proves itself with (the first when unset), and the row's fields by name.
 */
const setupShape = {
  method: z.string().optional(),
  settings: z.record(z.string(), z.string()).optional(),
};

/** A method the row does not offer, or a setting it does not name, is refused rather than handed to pi. */
function setupCheck(type: HostedLlmProviderType) {
  const setup = llmProviderTypeFacts(type).setup;
  const methods = new Set(setup?.methods?.map((method) => method.id));
  const names = new Set(setup?.fields.map((field) => field.name));
  return (instance: { method?: string; settings?: Record<string, string> }, ctx: z.RefinementCtx) => {
    if (instance.method !== undefined && !methods.has(instance.method)) {
      ctx.addIssue({ code: "custom", message: `${type} has no sign-in method ${instance.method}`, path: ["method"] });
    }
    for (const name of Object.keys(instance.settings ?? {})) {
      if (!names.has(name)) ctx.addIssue({ code: "custom", message: `${type} has no setting ${name}`, path: ["settings", name] });
    }
  };
}

/**
 * A hosted type is single-instance and its id is its type, so the provider the app registers is
 * the one pi stores credentials for; the `KnownProvider` bound fails the typecheck for a hosted
 * type that is not a pi provider at all. `auth` is fixed to what the type's row offers.
 */
function hostedProviderSchema<T extends HostedLlmProviderType & KnownProvider>(type: T) {
  const auth = authSchema<LlmAuthKindOf<T>>(llmProviderTypeTable[type].authKinds);
  return z
    .object({ ...providerBase, id: z.literal(type), type: z.literal(type), auth, ...setupShape })
    .superRefine(setupCheck(type));
}

type HostedProviderSchemas = { [T in HostedLlmProviderType]: ReturnType<typeof hostedProviderSchema<T>> };

const hostedProviderSchemas = Object.fromEntries(
  hostedLlmProviderTypes.map((type) => [type, hostedProviderSchema(type)]),
) as unknown as HostedProviderSchemas;

export const openAICompatibleProviderSchema = z.object({
  ...providerBase,
  id: endpointIdSchema,
  type: z.literal("openai-compatible"),
  auth: apiKeyAuth,
  /** Base URL up to and including the version segment, e.g. `https://api.example.com/v1`. */
  baseUrl: z.url({ protocol: /^https?$/, error: "must be an http(s) URL" }),
  models: z.array(customModelSchema).superRefine((models, ctx) => {
    const seen = new Set<string>();
    for (const [index, model] of models.entries()) {
      if (seen.has(model.id)) ctx.addIssue({ code: "custom", message: `duplicate model ${model.id}`, path: [index, "id"] });
      seen.add(model.id);
    }
  }),
});

/** An endpoint type's schema is written out, since its fields are its own; a missing one fails the typecheck. */
const endpointProviderSchemas = {
  "openai-compatible": openAICompatibleProviderSchema,
} satisfies Record<EndpointLlmProviderType, z.ZodObject>;

type ProviderSchema = HostedProviderSchemas[HostedLlmProviderType] | (typeof endpointProviderSchemas)[EndpointLlmProviderType];

const providerSchemas: Record<LlmProviderType, ProviderSchema> = { ...hostedProviderSchemas, ...endpointProviderSchemas };

const [firstType, ...otherTypes] = llmProviderTypes;

/** One schema per type, in table order, told apart by `type`. */
export const llmProviderSchema = z.discriminatedUnion("type", [
  providerSchemas[firstType],
  ...otherTypes.map((type) => providerSchemas[type]),
]);

/** A model as a rename notice names it, with its price in USD per million tokens. */
const noticeModelSchema = z.object({
  name: z.string(),
  pricing: z.object({ input: z.number(), output: z.number() }),
});

/**
 * Saved refs that startup moved off a model pi renamed and onto its successor
 * (`src/lib/llm/model-rewrite.ts`), shown in Settings › LLM until dismissed. The facts are kept
 * from the moment of the move: the old model is no longer in pi's catalog.
 */
const modelNoticeSchema = z.object({
  /** The provider instance's name. */
  provider: z.string(),
  from: noticeModelSchema,
  to: noticeModelSchema,
  /** What was moved: "the default model", "the scheduled task “…”". */
  uses: z.array(z.string()),
});

const llmSchema = z.object({
  providers: z.array(llmProviderSchema).superRefine((providers, ctx) => {
    const seen = new Set<string>();
    for (const [index, provider] of providers.entries()) {
      if (seen.has(provider.id)) {
        ctx.addIssue({ code: "custom", message: `duplicate provider id ${provider.id}`, path: [index, "id"] });
      }
      seen.add(provider.id);
    }
  }),
  /** May point at a provider or model that no longer exists; resolution treats that as unconfigured. */
  defaultModel: modelRefSchema.nullable(),
  thinkingLevel: z.enum(thinkingLevels),
  modelNotices: z.array(modelNoticeSchema).optional(),
});

/**
 * Modules keep their own fields; only `enabled` is common to all of them. An entry holds what the
 * user saved; a module's defaults live in its own `defaultConfig`, applied when the entry is read.
 */
const moduleSchema = z.looseObject({ enabled: z.boolean() });

/** Data domains a data connection may cover; `CoverageDomain` in `src/lib/tools/contracts.ts` is derived from it. */
export const coverageDomains = [
  "filings",
  "fundamentals",
  "earnings",
  "estimates",
  "prices",
  "options",
  "funds",
  "transcripts",
  "news",
  "ownership",
  "macro",
] as const;

const mcpServerSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  /**
   * What the server is to the harness: a data connection gets a source tier and coverage
   * and its results become evidence; a general tool does not. Servers saved before the field
   * existed count as general.
   */
  class: z.enum(["data", "general"]).optional(),
  /** Data connections only; defaults to 2 (licensed vendor). */
  tier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  coverage: z.array(z.enum(coverageDomains)).optional(),
  transport: z.enum(["http", "stdio"]),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  allowTools: z.array(z.string()).optional(),
  cacheTtlSeconds: z.number().optional(),
});

export const CONFIG_VERSION = 3;

export const appConfigSchema = z.object({
  version: z.literal(CONFIG_VERSION),
  llm: llmSchema,
  modules: z.record(z.string(), moduleSchema),
  mcp: z.object({ servers: z.array(mcpServerSchema) }),
});

export type AppConfig = z.infer<typeof appConfigSchema>;
export type McpServerConfig = z.infer<typeof mcpServerSchema>;
export type ThinkingLevel = (typeof thinkingLevels)[number];
export type LlmProviderConfig = z.infer<typeof llmProviderSchema>;
export type OpenRouterProviderConfig = Extract<LlmProviderConfig, { type: "openrouter" }>;
export type OpenAICompatibleProviderConfig = z.infer<typeof openAICompatibleProviderSchema>;
export type CustomModelConfig = z.infer<typeof customModelSchema>;
export type CustomThinkingConfig = z.infer<typeof customThinkingSchema>;
export type ThinkingOffMode = (typeof thinkingOffModes)[number];
export type McpServerClass = NonNullable<McpServerConfig["class"]>;
export type ModelRef = z.infer<typeof modelRefSchema>;
export type ModelNotice = z.infer<typeof modelNoticeSchema>;

export function defaultConfig(): AppConfig {
  return {
    version: CONFIG_VERSION,
    llm: { providers: [], defaultModel: null, thinkingLevel: "off" },
    // Each module declares its own defaults (`Module.defaultConfig`); only what the user saved lands here.
    modules: {},
    mcp: { servers: [] },
  };
}
