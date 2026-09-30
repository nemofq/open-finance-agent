import { describe, expect, it } from "vitest";
import type { LlmProviderConfig } from "@/lib/config/schema";
import type { ProviderAuthStatus } from "@/lib/llm/oauth/types";
import { type AuthStatusState, catalogEntryFor, connectAction, connectionStatus, needsConnecting, signsIn } from "./connection";

const claude: LlmProviderConfig = { id: "anthropic", type: "anthropic", name: "Claude (Pro/Max)", auth: "oauth", apiKey: "" };
const openRouter: LlmProviderConfig = { id: "openrouter", type: "openrouter", name: "OpenRouter", auth: "api_key", apiKey: "" };

function loaded(...rows: ProviderAuthStatus[]): AuthStatusState {
  return { rows, error: null };
}

describe("connectionStatus", () => {
  it("has nothing to say about a key provider", () => {
    expect(signsIn(openRouter)).toBe(false);
    expect(connectionStatus(openRouter, loaded({ provider: "openrouter", connected: true, type: "api_key" }))).toEqual({ kind: "none" });
  });

  it("waits for the status before deciding", () => {
    expect(connectionStatus(claude, { rows: null, error: null })).toEqual({ kind: "loading" });
  });

  it("reports a status that could not be read, rather than claiming a disconnection", () => {
    expect(connectionStatus(claude, { rows: null, error: "500 Internal Server Error" })).toEqual({
      kind: "failed",
      error: "500 Internal Server Error",
    });
  });

  it("carries the token's renewal time through", () => {
    const status = connectionStatus(claude, loaded({ provider: "anthropic", connected: true, type: "oauth", expires: 1_700_000_000_000 }));
    expect(status).toEqual({ kind: "connected", renewsAt: 1_700_000_000_000 });
    expect(connectAction(status)).toBe("Reconnect");
    expect(needsConnecting(status)).toBe(false);
  });

  it("is disconnected when the provider has no row, or one that is not signed in", () => {
    for (const status of [
      connectionStatus(claude, loaded()),
      connectionStatus(claude, loaded({ provider: "anthropic", connected: false, type: "oauth" })),
    ]) {
      expect(status).toEqual({ kind: "disconnected" });
      expect(connectAction(status)).toBe("Connect");
      expect(needsConnecting(status)).toBe(true);
    }
  });

  it("describes an Anthropic instance by the row it was added with", () => {
    expect(catalogEntryFor(claude)?.name).toBe("Claude (Pro/Max)");
    expect(catalogEntryFor({ ...claude, auth: "api_key", name: "Anthropic" })?.name).toBe("Anthropic");
  });

  it("does not take a stored key as a sign-in for a provider set to sign in", () => {
    expect(connectionStatus(claude, loaded({ provider: "anthropic", connected: true, type: "api_key" }))).toEqual({
      kind: "disconnected",
    });
  });
});
