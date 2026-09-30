import { describe, expect, it } from "vitest";
import { llmInstanceSecretPaths, llmProviderSecretPaths, type LlmProviderTypeFacts, providerSecretPaths } from "./provider-types";

describe("provider secret paths", () => {
  const row = (secretFields?: string[]): LlmProviderTypeFacts => ({
    name: "Gateway",
    description: "A gateway",
    keyHelp: { text: "A key" },
    authKinds: ["api_key"],
    multiple: true,
    category: "custom",
    ...(secretFields ? { secretFields } : {}),
  });

  it("masks every instance's apiKey whatever the rows declare", () => {
    expect(llmProviderSecretPaths).toContain("llm.providers.*.apiKey");
    expect(providerSecretPaths([])).toEqual(["llm.providers.*.apiKey"]);
  });

  it("adds each field a row declares as a secret, once", () => {
    expect(providerSecretPaths([row(["headers.*"]), row(["headers.*", "apiKey"]), row()])).toEqual([
      "llm.providers.*.apiKey",
      "llm.providers.*.headers.*",
    ]);
  });

  it("masks a setup field marked secret, and leaves the others readable", () => {
    expect(llmInstanceSecretPaths).toContain("settings.AWS_SECRET_ACCESS_KEY");
    expect(llmInstanceSecretPaths).toContain("settings.AWS_SESSION_TOKEN");
    expect(llmInstanceSecretPaths).not.toContain("settings.AWS_REGION");
  });
});
