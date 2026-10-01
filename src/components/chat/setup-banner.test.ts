import { describe, expect, it } from "vitest";
import type { ModelRef } from "@/lib/config/schema";
import { REAUTH_REQUIRED } from "@/lib/llm/catalog";
import type { LlmModelInfo, ProviderModels } from "@/lib/llm/types";
import { dataHintSuggestion, type SetupInput, setupNeed, setupNeedFor } from "./setup-banner";

describe("setupNeedFor", () => {
  it("turns a lapsed sign-in into the reconnect banner", () => {
    expect(setupNeedFor(REAUTH_REQUIRED)).toBe("reauth");
  });

  it("asks for a model when nothing is configured", () => {
    expect(setupNeedFor("llm_not_configured")).toBe("default");
  });

  it("leaves every other failure to the error line", () => {
    expect(setupNeedFor("model_unavailable")).toBeNull();
    expect(setupNeedFor("images_unsupported")).toBeNull();
    expect(setupNeedFor(undefined)).toBeNull();
  });
});

const model: LlmModelInfo = {
  id: "gpt-5.5",
  name: "GPT-5.5",
  contextLength: 400_000,
  pricing: { input: 0, output: 0 },
  supportsReasoning: true,
  supportsImages: true,
};

const codex: ModelRef = { provider: "openai-codex", model: "gpt-5.5" };

/** A signed-out provider still lists its catalog, which is what `listProviderModels` now returns. */
function signedOut(): ProviderModels {
  return {
    provider: "openai-codex",
    name: "ChatGPT (Codex)",
    type: "openai-codex",
    models: [model],
    error: "ChatGPT (Codex) is not signed in any more. Reconnect it in Settings › LLM.",
    authGap: REAUTH_REQUIRED,
  };
}

function connected(): ProviderModels {
  return { provider: "openai-codex", name: "ChatGPT (Codex)", type: "openai-codex", models: [model] };
}

/** A new chat on an available default: the state every case below varies one part of. */
function newChat(overrides: Partial<SetupInput> = {}): SetupInput {
  return {
    providers: [connected()],
    loaded: true,
    turnModel: codex,
    started: false,
    picked: false,
    defaultAvailable: true,
    refused: null,
    ...overrides,
  };
}

describe("setupNeed", () => {
  it("says nothing while everything the chat needs is in place", () => {
    expect(setupNeed(newChat())).toBeNull();
  });

  it("asks for a reconnection when the default model's provider is signed out", () => {
    expect(setupNeed(newChat({ providers: [signedOut()] }))).toBe("reauth");
  });

  it("asks for a reconnection on a started chat too, since that chat can carry on once signed in", () => {
    expect(setupNeed(newChat({ providers: [signedOut()], started: true }))).toBe("reauth");
  });

  it("does not mistake a signed-out provider for a model that has gone", () => {
    // The regression: with its catalog withheld, the model was missing from every list, so the chat
    // reported "no default model" and never offered the reconnect link.
    expect(setupNeed(newChat({ providers: [signedOut()], defaultAvailable: false }))).toBe("reauth");
  });

  it("leaves another provider's lapsed sign-in alone", () => {
    const providers = [{ ...signedOut(), provider: "anthropic", name: "Claude (Pro/Max)" } as ProviderModels, connected()];
    expect(setupNeed(newChat({ providers }))).toBeNull();
  });

  it("asks for a provider only once the lists have been read", () => {
    expect(setupNeed(newChat({ providers: [], loaded: false, turnModel: null, defaultAvailable: false }))).toBeNull();
    expect(setupNeed(newChat({ providers: [], turnModel: null, defaultAvailable: false }))).toBe("provider");
  });

  it("asks for a model when the default is unusable and none was picked", () => {
    expect(setupNeed(newChat({ defaultAvailable: false }))).toBe("default");
    expect(setupNeed(newChat({ defaultAvailable: false, picked: true }))).toBeNull();
  });

  it("keeps a refused turn's own answer", () => {
    expect(setupNeed(newChat({ refused: "default" }))).toBe("default");
    expect(setupNeed(newChat({ refused: "reauth" }))).toBe("reauth");
  });

  it("leaves a started chat's missing provider to its error line", () => {
    expect(setupNeed(newChat({ providers: [], turnModel: null, started: true, defaultAvailable: false }))).toBeNull();
  });
});

describe("dataHintSuggestion", () => {
  const QUOTES = { id: "quotes", name: "Market Quotes" };
  const EDGAR = { id: "edgar", name: "SEC EDGAR" };

  it("names both connections, with EDGAR's contact", () => {
    expect(dataHintSuggestion([QUOTES, EDGAR])).toBe(
      "Market Quotes and SEC EDGAR (both free; EDGAR needs a contact name and email)",
    );
  });

  it("names only the one missing, mentioning a contact only for EDGAR", () => {
    expect(dataHintSuggestion([EDGAR])).toBe("SEC EDGAR (free; it needs a contact name and email)");
    expect(dataHintSuggestion([QUOTES])).toBe("Market Quotes (free)");
  });

  it("keys the contact note on the id, not the display name", () => {
    expect(dataHintSuggestion([{ id: "edgar", name: "EDGAR" }])).toBe("EDGAR (free; it needs a contact name and email)");
  });
});
