import type { CacheRetention } from "@earendil-works/pi-ai";

/**
 * What the machine's environment may not change about a model request. A provider's key and
 * settings come from `config.json` and a sign-in from `auth.json` (docs/architecture.md › LLM
 * providers); these close the ways around that which pi-ai and the SDKs it drives leave open.
 */

/**
 * pi's own default, sent on every request, because pi reads `PI_CACHE_RETENTION` from the
 * environment only when a request names no retention, and would then ask every provider to keep
 * the prompt cache for an hour or a day.
 */
export const CACHE_RETENTION: CacheRetention = "short";

/**
 * Read straight from `process.env`, by pi-ai or by the OpenAI, Anthropic, Google and AWS SDKs,
 * where no per-request setting can override them, so they are removed before any provider code
 * runs. Left alone on purpose: proxy variables, `AWS_PROFILE`, and `PI_OAUTH_CALLBACK_HOST`, which
 * only sets the address a sign-in's local callback server listens on (0.0.0.0 in a container).
 */
export const CLEARED_PROVIDER_ENV = [
  // OpenAI SDK, under every OpenAI-style API: extra headers on every request.
  "OPENAI_ORG_ID",
  "OPENAI_PROJECT_ID",
  "OPENAI_CUSTOM_HEADERS",
  // Anthropic SDK: extra headers on every Anthropic Messages request.
  "ANTHROPIC_CUSTOM_HEADERS",
  // Google GenAI SDK: turns a Gemini request into a Vertex one, or sends Vertex to another host.
  "GOOGLE_GENAI_USE_VERTEXAI",
  "GOOGLE_GENAI_USE_ENTERPRISE",
  "GOOGLE_VERTEX_BASE_URL",
  // AWS SDK: sends signed Bedrock requests to another host.
  "AWS_ENDPOINT_URL",
  "AWS_ENDPOINT_URL_BEDROCK_RUNTIME",
  // pi: the host a Kimi sign-in and its token refresh talk to.
  "KIMI_CODE_OAUTH_HOST",
  "KIMI_OAUTH_HOST",
] as const;

/**
 * Removes every name in `CLEARED_PROVIDER_ENV` that is set, and says which (never their values).
 * Called where a process starts (the server's `register`, the benchmark CLI) and again each time a
 * pi `Models` collection is handed out (`models.ts`), because `next dev` puts back the environment
 * it started with whenever a `.env` file or the app's routes change. It is silent when nothing is
 * set, so the repeated calls cost nothing.
 */
export function clearProviderEnv(env: Record<string, string | undefined> = process.env): string[] {
  const cleared = CLEARED_PROVIDER_ENV.filter((name) => env[name] !== undefined);
  for (const name of cleared) delete env[name];
  if (cleared.length > 0) {
    console.log(`[llm] ignoring ${cleared.join(", ")} from the environment; provider settings come from config.json`);
  }
  return cleared;
}
