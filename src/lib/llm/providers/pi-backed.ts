import { homedir } from "node:os";
import path from "node:path";
import { type Api, getSupportedThinkingLevels, type Model, type Models, type Provider } from "@earendil-works/pi-ai";
import { amazonBedrockProvider } from "@earendil-works/pi-ai/providers/amazon-bedrock";
import { antLingProvider } from "@earendil-works/pi-ai/providers/ant-ling";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { azureOpenAIResponsesProvider } from "@earendil-works/pi-ai/providers/azure-openai-responses";
import { basetenProvider } from "@earendil-works/pi-ai/providers/baseten";
import { cerebrasProvider } from "@earendil-works/pi-ai/providers/cerebras";
import { cloudflareAIGatewayProvider } from "@earendil-works/pi-ai/providers/cloudflare-ai-gateway";
import { cloudflareWorkersAIProvider } from "@earendil-works/pi-ai/providers/cloudflare-workers-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { fireworksProvider } from "@earendil-works/pi-ai/providers/fireworks";
import { githubCopilotProvider } from "@earendil-works/pi-ai/providers/github-copilot";
import { googleVertexProvider } from "@earendil-works/pi-ai/providers/google-vertex";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { groqProvider } from "@earendil-works/pi-ai/providers/groq";
import { huggingfaceProvider } from "@earendil-works/pi-ai/providers/huggingface";
import { kimiCodingProvider } from "@earendil-works/pi-ai/providers/kimi-coding";
import { metaProvider } from "@earendil-works/pi-ai/providers/meta";
import { minimaxCnProvider } from "@earendil-works/pi-ai/providers/minimax-cn";
import { minimaxProvider } from "@earendil-works/pi-ai/providers/minimax";
import { mistralProvider } from "@earendil-works/pi-ai/providers/mistral";
import { moonshotaiCnProvider } from "@earendil-works/pi-ai/providers/moonshotai-cn";
import { moonshotaiProvider } from "@earendil-works/pi-ai/providers/moonshotai";
import { nvidiaProvider } from "@earendil-works/pi-ai/providers/nvidia";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { opencodeGoProvider } from "@earendil-works/pi-ai/providers/opencode-go";
import { opencodeProvider } from "@earendil-works/pi-ai/providers/opencode";
import { qwenTokenPlanCnProvider } from "@earendil-works/pi-ai/providers/qwen-token-plan-cn";
import { qwenTokenPlanIndividualProvider } from "@earendil-works/pi-ai/providers/qwen-token-plan-individual";
import { qwenTokenPlanProvider } from "@earendil-works/pi-ai/providers/qwen-token-plan";
import { togetherProvider } from "@earendil-works/pi-ai/providers/together";
import { vercelAIGatewayProvider } from "@earendil-works/pi-ai/providers/vercel-ai-gateway";
import { xaiProvider } from "@earendil-works/pi-ai/providers/xai";
import { xiaomiTokenPlanAmsProvider } from "@earendil-works/pi-ai/providers/xiaomi-token-plan-ams";
import { xiaomiTokenPlanCnProvider } from "@earendil-works/pi-ai/providers/xiaomi-token-plan-cn";
import { xiaomiTokenPlanSgpProvider } from "@earendil-works/pi-ai/providers/xiaomi-token-plan-sgp";
import { xiaomiProvider } from "@earendil-works/pi-ai/providers/xiaomi";
import { zaiCodingCnProvider } from "@earendil-works/pi-ai/providers/zai-coding-cn";
import { zaiProvider } from "@earendil-works/pi-ai/providers/zai";
import type { LlmAuthKind, LlmProviderConfig } from "@/lib/config/schema";
import {
  activeSettings,
  llmProviderCatalog,
  missingSetup,
  reauthRequiredMessage,
  setupMethod,
  takesKey,
} from "@/lib/llm/catalog";
import { CACHE_RETENTION } from "@/lib/llm/ambient-env";
import { providerErrorText } from "@/lib/llm/error-text";
import { probeContext } from "@/lib/llm/probe";
import type { HostedLlmProviderType } from "@/lib/llm/provider-types";
import type { LlmModelInfo, LlmProviderDefinition, ProviderValidation } from "@/lib/llm/types";
import { errorMessage } from "@/lib/utils";
import { configCredentialAuth } from "./auth";

/**
 * Every provider type pi-ai already implements: one definition for all of them, because pi owns the
 * catalog, the login, the refresh and the wire API, and only the auth an instance was saved with
 * differs.
 *
 * OpenRouter is not here: it keeps its own definition for the live catalog fetch.
 */

/** Hosted types backed by a pi provider factory; a hosted type missing from `piProviders` fails the typecheck. */
export type PiBackedType = Exclude<HostedLlmProviderType, "openrouter">;
type PiBackedConfig = Extract<LlmProviderConfig, { type: PiBackedType }>;

const piProviders: Record<PiBackedType, () => Provider> = {
  "amazon-bedrock": amazonBedrockProvider,
  "ant-ling": antLingProvider,
  anthropic: anthropicProvider,
  "azure-openai-responses": azureOpenAIResponsesProvider,
  baseten: basetenProvider,
  cerebras: cerebrasProvider,
  "cloudflare-ai-gateway": cloudflareAIGatewayProvider,
  "cloudflare-workers-ai": cloudflareWorkersAIProvider,
  deepseek: deepseekProvider,
  fireworks: fireworksProvider,
  "github-copilot": githubCopilotProvider,
  google: googleProvider,
  "google-vertex": googleVertexProvider,
  groq: groqProvider,
  huggingface: huggingfaceProvider,
  "kimi-coding": kimiCodingProvider,
  meta: metaProvider,
  minimax: minimaxProvider,
  "minimax-cn": minimaxCnProvider,
  mistral: mistralProvider,
  moonshotai: moonshotaiProvider,
  "moonshotai-cn": moonshotaiCnProvider,
  nvidia: nvidiaProvider,
  openai: openaiProvider,
  "openai-codex": openaiCodexProvider,
  opencode: opencodeProvider,
  "opencode-go": opencodeGoProvider,
  "qwen-token-plan": qwenTokenPlanProvider,
  "qwen-token-plan-cn": qwenTokenPlanCnProvider,
  "qwen-token-plan-individual": qwenTokenPlanIndividualProvider,
  together: togetherProvider,
  "vercel-ai-gateway": vercelAIGatewayProvider,
  xai: xaiProvider,
  xiaomi: xiaomiProvider,
  "xiaomi-token-plan-ams": xiaomiTokenPlanAmsProvider,
  "xiaomi-token-plan-cn": xiaomiTokenPlanCnProvider,
  "xiaomi-token-plan-sgp": xiaomiTokenPlanSgpProvider,
  zai: zaiProvider,
  "zai-coding-cn": zaiCodingCnProvider,
};

/**
 * pi's static catalog per type, built once. It is what `toPiModel` hands back: a catalog model
 * carries an API, a base URL, prices and compatibility flags that only pi knows.
 */
const catalogs = new Map<PiBackedType, Map<string, Model<Api>>>();

function catalog(type: PiBackedType): Map<string, Model<Api>> {
  let models = catalogs.get(type);
  if (!models) {
    models = new Map(piProviders[type]().getModels().map((model) => [model.id, model]));
    catalogs.set(type, models);
  }
  return models;
}

function toInfo(model: Model<Api>): LlmModelInfo {
  return {
    id: model.id,
    name: model.name,
    contextLength: model.contextWindow,
    pricing: { input: model.cost.input, output: model.cost.output },
    supportsReasoning: model.reasoning,
    thinkingLevels: getSupportedThinkingLevels(model),
    supportsImages: model.input.includes("image"),
    maxTokens: model.maxTokens,
  };
}

/** What pi's catalog lists for the type under `id`, as the pickers show it; undefined once pi dropped it. */
export function catalogModel(type: PiBackedType, id: string): LlmModelInfo | undefined {
  const model = catalog(type).get(id);
  return model && toInfo(model);
}

/**
 * The instance as pi should see it. A key instance authenticates from `config.json` alone, and a
 * sign-in instance from `auth.json` alone: dropping the other method is what stops an ambient
 * `ANTHROPIC_API_KEY` from standing in for the account the user connected. A key instance keeps
 * pi's own resolution, fed only what the config holds, because that resolution is what turns a
 * Cloudflare token into its header or Bedrock access keys into a signed request.
 */
function toPiProvider(config: PiBackedConfig): Provider {
  const provider = piProviders[config.type]();
  if (config.auth === "oauth") return { ...provider, auth: { oauth: provider.auth.oauth } };
  const own = provider.auth.apiKey;
  if (!own) throw new Error(`${provider.name} takes no API key`);
  const apiKey = takesKey(config) ? config.apiKey : "";
  return { ...provider, auth: { apiKey: configCredentialAuth(own, apiKey, requestSettings(config)) } };
}

/** Where `gcloud auth application-default login` leaves its credentials, as pi looks for them. */
const GCLOUD_ADC_FILE = path.join(homedir(), ".config", "gcloud", "application_default_credentials.json");

function expandHome(file: string): string {
  return file === "~" || file.startsWith("~/") ? path.join(homedir(), file.slice(1)) : file;
}

/**
 * The settings a request is sent with: the saved ones, plus a value for each name pi's wire APIs
 * would otherwise read from the process environment when the user left it unset. pi falls back to
 * the environment on an empty value, so each is pinned to a neutral one rather than blanked: for
 * Bedrock, the switches that skip signing, force HTTP/1.1 and add cache points to a model pi does
 * not know caches. Bedrock's bearer token and session token cannot be pinned that way; an exported
 * `AWS_BEARER_TOKEN_BEDROCK` or `AWS_SESSION_TOKEN` still reaches pi (see docs/architecture.md).
 */
export function requestSettings(config: PiBackedConfig): Record<string, string> {
  const settings = activeSettings(config);
  switch (config.type) {
    case "amazon-bedrock":
      return { AWS_BEDROCK_SKIP_AUTH: "0", AWS_BEDROCK_FORCE_HTTP1: "0", AWS_BEDROCK_FORCE_CACHE: "0", ...settings };
    case "azure-openai-responses":
      // A map of one empty entry parses to no mapping, so each model is its own deployment.
      return { AZURE_OPENAI_DEPLOYMENT_NAME_MAP: ",", AZURE_OPENAI_API_VERSION: "v1", ...settings };
    case "google-vertex": {
      const file = settings.GOOGLE_APPLICATION_CREDENTIALS;
      if (file) return { ...settings, GOOGLE_APPLICATION_CREDENTIALS: expandHome(file) };
      return setupMethod(config)?.id === "adc" ? { ...settings, GOOGLE_APPLICATION_CREDENTIALS: GCLOUD_ADC_FILE } : settings;
    }
    default:
      return settings;
  }
}

/**
 * What the account may actually use. `getAvailable` answers only for a provider whose auth is
 * configured, and applies the provider's own filter — which is how a GitHub Copilot account's
 * enabled models are honoured without us asking GitHub anything.
 */
async function listModels(config: PiBackedConfig, models: Models): Promise<LlmModelInfo[]> {
  return (await models.getAvailable(config.id)).map(toInfo);
}

/**
 * What pi knows the type offers without an account: the same list `getAvailable` filters. It lets a
 * provider awaiting a sign-in still name its models, though a Copilot account may end up with fewer.
 */
function catalogModels(config: PiBackedConfig): LlmModelInfo[] {
  return [...catalog(config.type).values()].map(toInfo);
}

function toPiModel(config: PiBackedConfig, info: LlmModelInfo): Model<Api> {
  // The id of a hosted instance is its pi provider id, so the catalog model already names it.
  const model = catalog(config.type).get(info.id);
  if (!model) throw new Error(`${config.name} does not offer ${info.id}`);
  return model;
}

/** The cheapest model to spend one request on, preferring one that will not think first. */
function probeModel(models: readonly Model<Api>[]): Model<Api> | undefined {
  const byCost = [...models].sort((a, b) => a.cost.output - b.cost.output || a.cost.input - b.cost.input);
  return byCost.find((model) => !model.reasoning) ?? byCost[0];
}

/** A key is only proven by spending it, so validation sends the shortest request the account allows. */
async function validateKey(config: PiBackedConfig, models: Models): Promise<ProviderValidation> {
  const missing = missingSetup(config);
  if (missing) return { ok: false, error: missing };
  const available = await models.getAvailable(config.id);
  const probe = probeModel(available);
  if (!probe) return { ok: false, error: `${config.name} lists no models` };
  // A cloud account reaches only the models it has enabled or deployed, which no catalog says, so
  // the cheapest one is no fair test; Test on a chosen model is.
  if (llmProviderCatalog[config.type].category === "cloud") {
    return {
      ok: true,
      message: `Settings complete · ${available.length} models. Test a model your account can use.`,
      models: available.map(toInfo),
    };
  }
  // The key goes as a chat turn sends it, so a stale sign-in in auth.json cannot answer in its place.
  const message = await models.completeSimple(probe, probeContext(), {
    ...(takesKey(config) && config.apiKey ? { apiKey: config.apiKey } : {}),
    cacheRetention: CACHE_RETENTION,
    maxTokens: 32,
    timeoutMs: 30_000,
  });
  if (message.stopReason === "error" || message.stopReason === "aborted") {
    const reason = message.errorMessage ? providerErrorText(message.errorMessage) : `request ${message.stopReason}`;
    return { ok: false, error: `${probe.name}: ${reason}` };
  }
  return { ok: true, message: `Key accepted · ${available.length} models`, models: available.map(toInfo) };
}

/** A sign-in is proven by the credential store holding a token for it; pi refreshes it when it is used. */
async function validateLogin(config: PiBackedConfig, models: Models): Promise<ProviderValidation> {
  const check = await models.checkAuth(config.id);
  if (check?.type !== "oauth") return { ok: false, error: reauthRequiredMessage(config.name) };
  const available = await models.getAvailable(config.id);
  return { ok: true, message: `Signed in · ${available.length} models`, models: available.map(toInfo) };
}

async function validate(config: PiBackedConfig, models: Models): Promise<ProviderValidation> {
  try {
    return config.auth === "oauth" ? await validateLogin(config, models) : await validateKey(config, models);
  } catch (err) {
    return { ok: false, error: providerErrorText(errorMessage(err)) };
  }
}

type PiBackedDefinitions = { [T in PiBackedType]: LlmProviderDefinition<Extract<LlmProviderConfig, { type: T }>> };

/**
 * Server implementation of every pi-backed type, keyed the way `llmProviderDefinitions` expects.
 * The functions take any pi-backed instance, so every type shares one definition, and the map
 * follows `piProviders` rather than listing the types a second time.
 */
const definition = { toPiProvider, validate, listModels, catalogModels, toPiModel };
export const piBackedDefinitions = Object.fromEntries(
  (Object.keys(piProviders) as PiBackedType[]).map((type) => [type, definition]),
) as unknown as PiBackedDefinitions;

/** The auth methods pi implements for a type; the catalog may offer fewer, never more. */
export function piAuthKinds(type: PiBackedType): LlmAuthKind[] {
  const { auth } = piProviders[type]();
  return [...(auth.apiKey ? (["api_key"] as const) : []), ...(auth.oauth ? (["oauth"] as const) : [])];
}
