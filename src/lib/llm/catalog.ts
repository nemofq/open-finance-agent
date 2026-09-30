/**
 * Client-safe facts about LLM providers: what can be added, how to label a model, and how
 * model references are keyed. No server imports here; the settings page and chat use it directly.
 */
import {
  type CustomModelConfig,
  isPiBuiltinProviderId,
  type LlmAuthKind,
  type LlmProviderConfig,
  type LlmProviderType,
  type ModelRef,
} from "@/lib/config/schema";
import {
  keyRequired,
  type LlmProviderCategory,
  type LlmProviderFamily,
  type LlmProviderSetup,
  llmProviderTypeFacts,
  llmProviderTypes,
  type LlmSetupField,
  type LlmSetupMethod,
} from "@/lib/llm/provider-types";
import type { LlmModelInfo } from "@/lib/llm/types";

export interface LlmProviderTypeInfo {
  type: LlmProviderType;
  /** Name shown in the "Add provider" list, and the default name of a new instance. */
  name: string;
  description: string;
  keyHelp: { text: string; url?: string };
  /** How an instance of this type may authenticate; a type offering both is added one way or the other. */
  authKinds: LlmAuthKind[];
  /** Whether an instance that authenticates by key must have one. An endpoint may need none. */
  keyRequired: boolean;
  /** Hosted providers are added once; endpoints can be added as many times as needed. */
  multiple: boolean;
  category: LlmProviderCategory;
  featured: boolean;
  family?: { id: LlmProviderFamily; variant: string };
  setup?: LlmProviderSetup;
}

function typeInfo(type: LlmProviderType): LlmProviderTypeInfo {
  const { name, description, keyHelp, authKinds, multiple, category, featured, family, setup } =
    llmProviderTypeFacts(type);
  return {
    type,
    name,
    description,
    keyHelp,
    authKinds: [...authKinds],
    keyRequired: keyRequired(type),
    multiple,
    category,
    featured: featured ?? false,
    ...(family ? { family } : {}),
    ...(setup ? { setup } : {}),
  };
}

/** What the settings page says about each type, read from the one table in `provider-types.ts`. */
export const llmProviderCatalog = Object.fromEntries(llmProviderTypes.map((type) => [type, typeInfo(type)])) as Record<
  LlmProviderType,
  LlmProviderTypeInfo
>;

/** One row of the "Add provider" list. A type that can be added two ways has one row per way. */
export interface LlmCatalogEntry extends LlmProviderTypeInfo {
  /** Stable key for the row: the type, and the auth kind when the type has more than one row. */
  id: string;
  /** The auth kind this row adds the provider with. */
  auth: LlmAuthKind;
  /** Which heading the row sits under in the dialog. */
  group: "signin" | "api_key" | "custom";
  /** Shown as a warning badge: the provider may withdraw this way in without notice. */
  experimental?: boolean;
}

type EntryOverrides = Partial<Pick<LlmCatalogEntry, "name" | "description" | "experimental" | "featured">>;

/**
 * Rows that say something other than their type's own name and description. A type offering a
 * key and a sign-in appears twice, because a subscription and a key are different products. A
 * subscription its company may withdraw from other apps is experimental: Anthropic's, and Meta's,
 * whose sign-in pi makes with the Muse Code CLI's client id. xAI's key is featured and its
 * subscription is not.
 */
const entryOverrides: Partial<Record<string, EntryOverrides>> = {
  "anthropic:oauth": {
    name: "Claude (Pro/Max)",
    description: "Use the Claude subscription you already pay for.",
    experimental: true,
  },
  "meta:oauth": {
    name: "Meta (Muse)",
    description: "Use a Muse subscription through your Meta account.",
    experimental: true,
  },
  "xai:oauth": {
    name: "SuperGrok / X Premium",
    description: "Use the Grok subscription you already pay for.",
    featured: false,
  },
  "kimi-coding:oauth": {
    name: "Kimi Code",
    description: "Use a Kimi Code subscription.",
  },
};

/** The dialog's headings, in the order it shows them. */
const groups: readonly LlmCatalogEntry["group"][] = ["signin", "api_key", "custom"];

/** A sign-in is its own heading; a key is a hosted provider's, and an endpoint's key is part of the endpoint. */
function groupOf(info: LlmProviderTypeInfo, auth: LlmAuthKind): LlmCatalogEntry["group"] {
  if (auth === "oauth") return "signin";
  return info.multiple ? "custom" : "api_key";
}

/**
 * Every way a provider can be added, in the order the dialog lists them: by heading, then in table
 * order. `multiple` is false for Anthropic, so whichever of its two rows is used, the other is spent.
 */
export const catalogEntries: LlmCatalogEntry[] = groups.flatMap((group) =>
  llmProviderTypes.flatMap((type) => {
    const info = llmProviderCatalog[type];
    return info.authKinds
      .filter((auth) => groupOf(info, auth) === group)
      .map((auth): LlmCatalogEntry => {
        const id = info.authKinds.length > 1 ? `${type}:${auth}` : type;
        return { ...info, id, auth, group, ...entryOverrides[id] };
      });
  }),
);

/** How an instance authenticates; an instance saved before config v3 used a key. */
export function providerAuthKind(provider: LlmProviderConfig): LlmAuthKind {
  return provider.auth ?? "api_key";
}

/** What a hosted instance holds besides its key; an endpoint holds neither. */
function setupOf(provider: LlmProviderConfig): { method?: string; settings?: Record<string, string> } {
  return provider.type === "openai-compatible" ? {} : provider;
}

/** The method a key instance of a type with several proves itself with: the one saved, else the row's first. */
export function setupMethod(provider: LlmProviderConfig): LlmSetupMethod | undefined {
  const methods = llmProviderCatalog[provider.type].setup?.methods;
  if (!methods) return undefined;
  const saved = setupOf(provider).method;
  return methods.find((method) => method.id === saved) ?? methods[0];
}

/** Whether a key instance asks for a key: always, unless its method takes none. A sign-in never does. */
export function takesKey(provider: LlmProviderConfig): boolean {
  if (providerAuthKind(provider) === "oauth") return false;
  const method = setupMethod(provider);
  return method ? method.key !== undefined : true;
}

/** The setup fields the instance's method asks for, in row order. */
export function setupFields(provider: LlmProviderConfig): LlmSetupField[] {
  if (providerAuthKind(provider) === "oauth") return [];
  const method = setupMethod(provider);
  return (llmProviderCatalog[provider.type].setup?.fields ?? []).filter(
    (field) => !field.methods || (method !== undefined && field.methods.includes(method.id)),
  );
}

/**
 * The settings pi is handed: only the fields the current method asks for, trimmed, and only those
 * set. A value left from another method stays in the config but never reaches the provider.
 */
export function activeSettings(provider: LlmProviderConfig): Record<string, string> {
  const settings = setupOf(provider).settings ?? {};
  return Object.fromEntries(
    setupFields(provider).flatMap((field) => {
      const value = settings[field.name]?.trim();
      return value ? [[field.name, value]] : [];
    }),
  );
}

/**
 * What a key instance still lacks before it can make a request, as the one line the card and a
 * refused chat show, or undefined when nothing is. A sign-in's credential is not in the config, so
 * it is not asked about here.
 */
export function missingSetup(provider: LlmProviderConfig): string | undefined {
  if (providerAuthKind(provider) === "oauth") return undefined;
  const method = setupMethod(provider);
  const needsKey = method ? method.key !== undefined : llmProviderCatalog[provider.type].keyRequired;
  if (needsKey && !provider.apiKey) return `Add ${method?.key ? `the ${method.key.label}` : "an API key"}`;
  const settings = activeSettings(provider);
  const missing = setupFields(provider).find((field) => !field.optional && !settings[field.name]);
  return missing ? `Add the ${missing.label.charAt(0).toLowerCase()}${missing.label.slice(1)}` : undefined;
}

/** Whether another instance of `type` may be added next to `providers`. */
export function canAddProvider(type: LlmProviderType, providers: LlmProviderConfig[]): boolean {
  return llmProviderCatalog[type].multiple || !providers.some((provider) => provider.type === type);
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "endpoint"
  );
}

/**
 * Single-instance types are registered under their type, which is the pi provider id the schema
 * fixes them to; endpoints get `slug-xxxx`, retried until the id is both free and outside pi-ai's
 * provider namespace, which the schema refuses for an endpoint.
 */
export function newProviderId(type: LlmProviderType, name: string, takenIds: string[]): string {
  if (!llmProviderCatalog[type].multiple) return type;
  const base = slug(name);
  for (;;) {
    const id = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    if (!takenIds.includes(id) && !isPiBuiltinProviderId(id)) return id;
  }
}

/**
 * A blank provider for a catalog row, added straight from the "Add provider" list. An endpoint is
 * built by the add dialog instead, from the name, URL and key its form asks for.
 */
export function createProvider(row: LlmCatalogEntry, takenIds: string[]): LlmProviderConfig {
  if (row.type === "openai-compatible") throw new Error("An endpoint is built from the add dialog's own form");
  return {
    id: newProviderId(row.type, row.name, takenIds),
    type: row.type,
    name: row.name,
    apiKey: "",
    auth: row.auth,
  } as LlmProviderConfig;
}

/** Stable string form of a model reference, for React keys and list values. */
export function modelRefKey(ref: ModelRef): string {
  return `${ref.provider}/${ref.model}`;
}

export function sameModelRef(a: ModelRef | null | undefined, b: ModelRef | null | undefined): boolean {
  return !!a && !!b && a.provider === b.provider && a.model === b.model;
}

function inferContextLength(id: string): number {
  const lower = id.toLowerCase();
  if (lower.includes("qwen") || lower.includes("llama-3") || lower.includes("llama3")) return 131_072;
  if (lower.includes("deepseek")) return 65_536;
  if (lower.includes("gpt-4") || lower.includes("gpt-4o")) return 128_000;
  return 0;
}

/**
 * A hand-listed endpoint model as the pickers and the agent see it: price unknown.
 * Reasoning and image input are the user's word, since the endpoint never reports either.
 */
export function customModelInfo(model: CustomModelConfig): LlmModelInfo {
  return {
    id: model.id,
    name: model.name ?? model.id,
    contextLength: model.contextWindow ?? inferContextLength(model.id),
    pricing: { input: 0, output: 0 },
    supportsReasoning: model.reasoning ?? false,
    supportsImages: model.images ?? false,
    ...(model.maxTokens ? { maxTokens: model.maxTokens } : {}),
  };
}

/** A model known only by its id, such as one an endpoint lists or a hand-typed one: price unknown, text only, no reasoning. */
export function neutralModelInfo(id: string, contextLength = 0): LlmModelInfo {
  return { id, name: id, contextLength, pricing: { input: 0, output: 0 }, supportsReasoning: false, supportsImages: false };
}

/** How a model is named everywhere in the UI: "OpenRouter · Claude Sonnet 5". */
export function modelLabel(providerName: string, modelName: string): string {
  return `${providerName} · ${modelName}`;
}

/**
 * The code an expired or withdrawn sign-in fails with, everywhere it can be met: a chat turn, a
 * model list, a scheduled run. The banner and the provider card match on the code, not the text.
 */
export const REAUTH_REQUIRED = "reauth_required";

/** Why a request stopped and what fixes it; one sentence, because it is shown inline. */
export function reauthRequiredMessage(providerName: string): string {
  return `${providerName} is not signed in any more. Reconnect it in Settings › LLM.`;
}

/** A saved model its provider no longer lists: the refusal a chat or a task gets, and the flag on the default in Settings. */
export function modelMissingMessage(providerName: string, model: string): string {
  return `${providerName} does not offer ${model} any more.`;
}
