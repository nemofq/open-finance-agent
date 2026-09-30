/**
 * pi's Gemini and Vertex adapters refuse any fetch but the global one, so a turn on either must
 * leave `fetch` unset rather than hand them the execution budget's wrapper. A turn runs through
 * `runTurn` and the real pi stack with only the global `fetch` stubbed, which answers every
 * request with an error: the request has to be attempted for that stub to see it.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AppConfig, defaultConfig, type LlmProviderConfig, type ModelRef } from "@/lib/config/schema";
import { createSession, getSession, updateSession } from "@/lib/sessions/store";
import { fixedTimeContext } from "@/lib/time";
import { withModulesOff } from "@/lib/tools/testing";
import { runTurn } from "./turn";

interface GoogleCase {
  name: string;
  provider: LlmProviderConfig;
  model: ModelRef;
}

const cases: GoogleCase[] = [
  {
    name: "Gemini",
    provider: { id: "google", type: "google", name: "Google Gemini", auth: "api_key", apiKey: "gemini-test" },
    model: { provider: "google", model: "gemini-3.1-pro-preview" },
  },
  {
    name: "Vertex",
    provider: { id: "google-vertex", type: "google-vertex", name: "Google Vertex AI", auth: "api_key", apiKey: "vertex-test" },
    model: { provider: "google-vertex", model: "gemini-3.1-pro-preview" },
  },
];

let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-google-fetch-"));
  process.env.OFA_HOME = home;
});

afterEach(() => {
  delete process.env.OFA_HOME;
  rmSync(home, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

function configFor(google: GoogleCase): AppConfig {
  const config = defaultConfig();
  withModulesOff(config, ["attachments", "edgar", "evidence", "memory", "portfolio", "quotes", "reports", "scheduled", "skills"]);
  config.llm.providers = [google.provider];
  config.llm.defaultModel = google.model;
  return config;
}

describe("a Google turn", () => {
  it.each(cases)("$name: reaches the network", async (google) => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string | URL | Request) => {
      urls.push(String(url));
      return Response.json({ error: { code: 400, message: "Stubbed refusal", status: "INVALID_ARGUMENT" } }, { status: 400 });
    });
    const { id } = await createSession({ model: google.model });
    const session = await getSession(id);
    if (!session) throw new Error("the chat was not saved");

    const result = await runTurn({
      config: configFor(google), session, text: "What was Apple's revenue in fiscal 2024?",
      time: fixedTimeContext({ asOf: "2024-08-29" }), titles: false, store: { update: updateSession },
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Stubbed refusal");
    expect(urls).toEqual([expect.stringContaining("gemini-3.1-pro-preview")]);
  });
});
