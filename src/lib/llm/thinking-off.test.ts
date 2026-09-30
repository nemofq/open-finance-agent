import { type Api, type AssistantMessageEventStream, type Model, normalizeContext, type SimpleStreamOptions, type TranscriptContext } from "@earendil-works/pi-ai";
import { getBuiltinModels, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";
import { describe, expect, it } from "vitest";
import { hostedOff } from "./thinking-off";

type StreamSimple = (model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions) => AssistantMessageEventStream;

const context = normalizeContext({ systemPrompt: "Be brief.", messages: [{ role: "user", content: "Hi", timestamp: 0 }] });

/** A Codex sign-in token only has to name an account for pi to build the request. */
const codexToken = `x.${btoa(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "account" } }))}.x`;

/** The request pi builds for `model` at Off, as the agent sends Off: no level. Nothing leaves the process. */
async function offRequest(model: Model<Api>): Promise<Record<string, unknown>> {
  const { streamSimple } = await import(`@earendil-works/pi-ai/api/${model.api}`) as { streamSimple: StreamSimple };
  let payload: Record<string, unknown> | undefined;
  const stream = streamSimple(model, context, {
    apiKey: model.api === "openai-codex-responses" ? codexToken : "key",
    env: { AWS_REGION: "us-east-1", AWS_ACCESS_KEY_ID: "id", AWS_SECRET_ACCESS_KEY: "secret",
      GOOGLE_CLOUD_PROJECT: "project", GOOGLE_CLOUD_LOCATION: "us-central1", AZURE_OPENAI_BASE_URL: "https://example.openai.azure.com/openai/v1",
      CLOUDFLARE_ACCOUNT_ID: "account", CLOUDFLARE_GATEWAY_ID: "gateway" },
    // pi's Google APIs refuse a custom fetch; the payload hook throws before any of them sends.
    ...(model.api.startsWith("google") ? {} : { fetch: async () => { throw new Error("no network in tests"); } }),
    onPayload: (built) => {
      payload = built as Record<string, unknown>;
      throw new Error("captured");
    },
  });
  let failure = "";
  for await (const event of stream) if (event.type === "error") failure = event.error.errorMessage ?? "";
  if (!payload) throw new Error(`pi built no request for ${model.provider}/${model.id}: ${failure}`);
  return payload;
}

type Json = Record<string, unknown> | undefined;
const field = (value: unknown, key: string): unknown => (value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined);

/** How a built request encodes Off, read off its fields: an effort, a Gemini level, a switch, or nothing. */
function offIn(request: Record<string, unknown>): string {
  const effort = field(request.reasoning, "effort") ?? request.reasoning_effort ?? request.reasoningEffort ??
    field(request.output_config, "effort") ?? (typeof request.thinking === "string" ? request.thinking : undefined);
  if (typeof effort === "string") return `"${effort}"`;
  const gemini = field(request.config, "thinkingConfig") as Json;
  if (typeof gemini?.thinkingLevel === "string") return gemini.thinkingLevel.toLowerCase();
  const disabled = field(request.thinking, "type") === "disabled" || request.enable_thinking === false ||
    field(request.reasoning, "enabled") === false || gemini?.thinkingBudget === 0 ||
    field(request.chat_template_kwargs, "enable_thinking") === false || field(request.chat_template_args, "enable_thinking") === false;
  if (disabled) return "disabled";
  if (request.additionalModelRequestFields !== undefined) return `unexpected: ${JSON.stringify(request.additionalModelRequestFields)}`;
  return "not sent";
}

/** A Gemini record names the level and, when the catalog maps it, the value: `minimal → "low"`; the request carries the value. */
const sentPart = (record: string) => (record.split(" → ").at(-1) ?? record).replaceAll('"', "").toLowerCase();

describe("what a hosted model's request carries at thinking Off", () => {
  it("matches the request pi builds, for every reasoning model in pi's catalogs", async () => {
    const mismatches: string[] = [];
    const apis = new Set<string>();
    for (const provider of getBuiltinProviders()) {
      for (const model of (getBuiltinModels(provider) as Model<Api>[]).filter((entry) => entry.reasoning)) {
        apis.add(model.api);
        const sent = offIn(await offRequest(model));
        const recorded = hostedOff(model);
        const gemini = model.api.startsWith("google") && !["disabled", "not sent"].includes(sent);
        if (gemini ? sentPart(recorded) !== sent : recorded !== sent) {
          mismatches.push(`${provider}/${model.id} (${model.api}): recorded ${recorded}, sent ${sent}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
    expect([...apis]).toEqual(expect.arrayContaining(["anthropic-messages", "azure-openai-responses", "bedrock-converse-stream",
      "google-generative-ai", "google-vertex", "mistral-conversations", "openai-codex-responses", "openai-completions", "openai-responses"]));
  }, 60_000);

  it("names the effort the Responses APIs send, and nothing for a model that cannot turn thinking off", () => {
    const codex = getBuiltinModels("openai-codex").find((model) => model.reasoning && model.thinkingLevelMap?.off !== null);
    expect(codex && hostedOff(codex)).toBe(`"${codex?.thinkingLevelMap?.off ?? "none"}"`);
    const always = getBuiltinModels("openai").find((model) => model.reasoning && model.thinkingLevelMap?.off === null);
    expect(always && hostedOff(always)).toBe("not sent");
  });

  it("reads Anthropic's managed effort as high, since Off sends no level to lower it", () => {
    const managed = getBuiltinModels("anthropic").filter((model) => model.compat?.supportsMidConvoEffort === true);
    expect(managed.length).toBeGreaterThan(0);
    for (const model of managed) expect(hostedOff(model), model.id).toBe('"high"');
  });
});
