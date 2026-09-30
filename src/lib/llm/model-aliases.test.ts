import { describe, expect, it } from "vitest";
import { modelAlias, modelAliases } from "./model-aliases";
import { catalogModel } from "./providers/pi-backed";

/**
 * Keeps the listed aliases true to the installed catalog: an alias whose source pi lists again, or
 * whose successor pi dropped, fails here until the table is brought up to date. It cannot see an
 * id the table never listed; `node scripts/pi-catalog-diff.mjs <old version>` lists every id an
 * upgrade removes, for deciding which to alias.
 */
describe("modelAliases", () => {
  it.each(modelAliases)("moves $type $from, gone from the installed catalog, to $to, listed in it", ({ type, from, to }) => {
    expect(catalogModel(type, from)).toBeUndefined();
    expect(catalogModel(type, to)).toBeDefined();
  });

  it("gives a retired model no successor", () => {
    expect(catalogModel("openai-codex", "gpt-5.4")).toBeUndefined();
    expect(modelAlias("openai-codex", "gpt-5.4")).toBeUndefined();
    expect(modelAlias("openai-codex", "gpt-5.4-mini")).toBeUndefined();
  });

  it("matches the provider type as well as the id", () => {
    expect(modelAlias("deepseek", "deepseek-v4-flash")?.to).toBe("deepseek-flash");
    expect(modelAlias("openai-compatible", "deepseek-v4-flash")).toBeUndefined();
    expect(modelAlias("fireworks", "deepseek-v4-flash")).toBeUndefined();
  });
});
