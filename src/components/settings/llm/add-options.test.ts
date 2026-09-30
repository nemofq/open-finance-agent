import { describe, expect, it } from "vitest";
import type { LlmProviderConfig } from "@/lib/config/schema";
import { catalogEntries } from "@/lib/llm/catalog";
import { experimentalCaveat, familyOptions, type ProviderListItem, providerList, searchProviders } from "./add-options";

const claudeSignIn: LlmProviderConfig = { id: "anthropic", type: "anthropic", name: "Claude (Pro/Max)", auth: "oauth", apiKey: "" };
const anthropicKey: LlmProviderConfig = { id: "anthropic", type: "anthropic", name: "Anthropic", auth: "api_key", apiKey: "" };
const endpoint: LlmProviderConfig = {
  id: "local-ab12",
  type: "openai-compatible",
  name: "Local",
  apiKey: "",
  baseUrl: "http://localhost:8000/v1",
  models: [],
};

/** A list item by its catalog id, or `family:<id>` for a company's row. */
const itemId = (item: ProviderListItem) => (item.kind === "family" ? `family:${item.family.id}` : item.option.entry.id);

/** The rows of one featured heading, by id. */
function featured(providers: LlmProviderConfig[], heading: string): string[] {
  return providerList(providers).featured.find((section) => section.id === heading)!.items.map(itemId);
}

/** Every catalog id reachable from the list, a company's editions included. */
function reachable(providers: LlmProviderConfig[]): string[] {
  const { featured, more } = providerList(providers);
  return [...featured, ...more].flatMap((section) =>
    section.items.flatMap((item) =>
      item.kind === "family" ? item.family.options.map((option) => option.entry.id) : [item.option.entry.id],
    ),
  );
}

/** Every option in the list, by catalog id. */
function allOptions(providers: LlmProviderConfig[]) {
  const { featured, more } = providerList(providers);
  return [...featured, ...more].flatMap((section) =>
    section.items.flatMap((item) => (item.kind === "family" ? item.family.options : [item.option])),
  );
}

describe("providerList", () => {
  it("shows the featured rows under the three headings, in the catalog's order", () => {
    expect(providerList([]).featured.map((section) => section.id)).toEqual(["signin", "api_key", "custom"]);
    expect(featured([], "signin")).toEqual(["anthropic:oauth", "openai-codex", "github-copilot"]);
    expect(featured([], "api_key")).toEqual([
      "openrouter",
      "anthropic:api_key",
      "openai",
      "google",
      "xai:api_key",
      "deepseek",
      "opencode",
      "opencode-go",
    ]);
    expect(featured([], "custom")).toEqual(["openai-compatible"]);
  });

  it("puts every other row behind More, sign-ins first and then by category", () => {
    const { more } = providerList([]);
    expect(more.map((section) => section.title)).toEqual([
      "Sign in",
      "Model makers",
      "Open-model hosts",
      "Gateways",
      "Cloud platforms",
    ]);
    expect(more[0].items.map(itemId)).toEqual(["xai:oauth", "meta:oauth", "kimi-coding:oauth"]);
  });

  it("reaches every catalog row exactly once", () => {
    const ids = reachable([]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ids)).toEqual(new Set(catalogEntries.map((entry) => entry.id)));
  });

  it("gathers a company's editions into one row, counted once", () => {
    const makers = providerList([]).more.find((section) => section.title === "Model makers")!;
    const moonshot = makers.items.find((item) => item.kind === "family" && item.family.id === "moonshot");
    expect(moonshot?.kind === "family" && moonshot.family.options.map((option) => option.entry.id)).toEqual([
      "moonshotai",
      "moonshotai-cn",
    ]);
    const { more, moreCount } = providerList([]);
    expect(moreCount).toBe(more.reduce((sum, section) => sum + section.items.length, 0));
    expect(moreCount).toBeLessThan(reachable([]).length - 12);
  });

  it("closes a company's row only once every edition is taken", () => {
    const taken = (ids: ("minimax" | "minimax-cn")[]) =>
      ids.map((id): LlmProviderConfig => ({ id, type: id, name: id, apiKey: "" }) as LlmProviderConfig);
    const family = (providers: LlmProviderConfig[]) =>
      providerList(providers)
        .more.flatMap((section) => section.items)
        .find((item) => item.kind === "family" && item.family.id === "minimax");
    expect(family(taken(["minimax"]))).toMatchObject({ family: { disabledReason: null } });
    expect(family(taken(["minimax", "minimax-cn"]))).toMatchObject({ family: { disabledReason: "Already added" } });
  });

  it("offers everything while nothing is configured", () => {
    expect(allOptions([]).every((option) => option.disabledReason === null)).toBe(true);
  });

  it("says how a type was taken when the other row of the same type is used", () => {
    const signin = allOptions([claudeSignIn]);
    expect(signin.find((option) => option.entry.id === "anthropic:oauth")?.disabledReason).toBe("Already added");
    expect(signin.find((option) => option.entry.id === "anthropic:api_key")?.disabledReason).toBe("Added as a sign-in");

    const keyed = allOptions([anthropicKey]);
    expect(keyed.find((option) => option.entry.id === "anthropic:oauth")?.disabledReason).toBe("Added with an API key");
    expect(keyed.find((option) => option.entry.id === "anthropic:api_key")?.disabledReason).toBe("Already added");
  });

  it("keeps the endpoint row open however many endpoints exist", () => {
    const options = allOptions([endpoint, { ...endpoint, id: "local-cd34" }]);
    expect(options.find((option) => option.entry.id === "openai-compatible")?.disabledReason).toBeNull();
  });
});

describe("familyOptions", () => {
  it("lists a company's editions in table order, with their own reasons", () => {
    const options = familyOptions([{ id: "zai", type: "zai", name: "Z.AI", apiKey: "" }], "zai");
    expect(options.map((option) => [option.entry.id, option.entry.family?.variant, option.disabledReason])).toEqual([
      ["zai", "Global (z.ai)", "Already added"],
      ["zai-coding-cn", "China (bigmodel.cn)", null],
    ]);
  });
});

describe("searchProviders", () => {
  const ids = (query: string) => searchProviders([], query).map((option) => option.entry.id);

  it("finds a provider by name, by id and by any word of its description", () => {
    expect(ids("groq")).toEqual(["groq"]);
    expect(ids("opencode")).toEqual(["opencode", "opencode-go"]);
    expect(ids("bedrock")).toEqual(["amazon-bedrock"]);
  });

  it("finds each edition of a company, and narrows to one by its region", () => {
    expect(ids("moonshot")).toEqual(expect.arrayContaining(["moonshotai", "moonshotai-cn"]));
    expect(ids("moonshot china")).toEqual(["moonshotai-cn"]);
  });

  it("lists featured rows before the rest", () => {
    const results = ids("grok");
    expect(results.indexOf("xai:api_key")).toBeLessThan(results.indexOf("xai:oauth"));
  });

  it("finds sign-ins by the word, and nothing for a name no row has", () => {
    expect(ids("sign in")).toEqual(expect.arrayContaining(["anthropic:oauth", "xai:oauth", "meta:oauth", "kimi-coding:oauth"]));
    expect(ids("no such provider")).toEqual([]);
  });
});

describe("experimentalCaveat", () => {
  it("names the company that may withdraw the sign-in", () => {
    const caveat = (id: string) => experimentalCaveat(catalogEntries.find((entry) => entry.id === id)!);
    expect(caveat("anthropic:oauth")).toMatch(/^Anthropic may limit subscription sign-in/);
    expect(caveat("meta:oauth")).toMatch(/^Meta may limit subscription sign-in/);
  });
});
