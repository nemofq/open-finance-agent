import { describe, expect, it } from "vitest";
import type { ModuleContext } from "@/lib/tools/contracts";
import { statementLines } from "./xbrl/statements";
import { edgarModule } from "./module";

describe("edgar_financials tool text", () => {
  it("lists every line of every statement, read from the definitions", async () => {
    const tools = await edgarModule.createTools({ enabled: true, contact: "Test test@example.com" }, {} as ModuleContext);
    const tool = tools.find((t) => t.name === "edgar_financials")!;
    const statement = (tool.parameters as { properties: { statement: { description: string } } }).properties.statement.description;
    for (const [id, lines] of Object.entries(statementLines)) {
      expect(lines.length, id).toBeGreaterThan(0);
      expect(statement, id).toContain(`${id}: ${lines.join(", ")}`);
      expect(tool.label, id).toContain(`${id}: ${lines.join(", ")}`);
    }
    expect(statement).toContain("cashflow: operatingCashFlow, capex, freeCashFlow");
    expect(tool.description).toMatch(/just-reported quarter, look first at the newest column here/);
  });
});

describe("an EDGAR module without a contact", () => {
  it("contributes no tools, and Validate says what is missing", async () => {
    expect(await edgarModule.createTools({ enabled: true, contact: "" }, {} as ModuleContext)).toEqual([]);
    expect(await edgarModule.validate?.({ enabled: true, contact: "" })).toEqual({ ok: false, message: expect.stringMatching(/needs a contact/) });
  });
});
