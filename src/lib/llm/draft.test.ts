import { describe, expect, it } from "vitest";
import type { LlmProviderConfig } from "@/lib/config/schema";
import { SECRET_MASK } from "@/lib/config/secrets";
import { restoreDraftKey } from "./draft";

const openrouter: LlmProviderConfig = { id: "openrouter", type: "openrouter", name: "OpenRouter", apiKey: "sk-or-saved" };
const endpoint: LlmProviderConfig = {
  id: "lab-a1b2",
  type: "openai-compatible",
  name: "Lab",
  apiKey: "sk-lab-saved",
  baseUrl: "https://llm.example.com/v1",
  models: [{ id: "qwen-27b" }],
};

describe("restoreDraftKey", () => {
  const saved = [openrouter, endpoint];

  it("restores a masked key from the saved provider with the same id and type", () => {
    const draft = { ...endpoint, apiKey: SECRET_MASK, baseUrl: "https://moved.example.com/v1" };
    expect(restoreDraftKey(draft, saved).apiKey).toBe("sk-lab-saved");
  });

  it("never lends a key to a provider of another type or id", () => {
    const sameIdOtherType: LlmProviderConfig = { ...endpoint, id: "openrouter", apiKey: SECRET_MASK };
    expect(restoreDraftKey(sameIdOtherType, saved).apiKey).toBe("");
    expect(restoreDraftKey({ ...endpoint, id: "new-e5f6", apiKey: SECRET_MASK }, saved).apiKey).toBe("");
  });

  it("keeps a key typed in the form", () => {
    expect(restoreDraftKey({ ...endpoint, apiKey: "sk-new" }, saved).apiKey).toBe("sk-new");
  });

  it("restores a masked secret setting too, and only that one", () => {
    const bedrock: Extract<LlmProviderConfig, { type: "amazon-bedrock" }> = {
      id: "amazon-bedrock",
      type: "amazon-bedrock",
      name: "Amazon Bedrock",
      apiKey: "",
      method: "access-keys",
      settings: { AWS_ACCESS_KEY_ID: "AKIA", AWS_SECRET_ACCESS_KEY: "saved-secret", AWS_REGION: "us-east-1" },
    };
    const draft = { ...bedrock, settings: { ...bedrock.settings, AWS_SECRET_ACCESS_KEY: SECRET_MASK, AWS_REGION: "eu-west-1" } };
    expect(restoreDraftKey(draft, [bedrock])).toMatchObject({
      settings: { AWS_ACCESS_KEY_ID: "AKIA", AWS_SECRET_ACCESS_KEY: "saved-secret", AWS_REGION: "eu-west-1" },
    });
  });
});
