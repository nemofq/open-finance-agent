import { describe, expect, it } from "vitest";
import type { PrivacySummary } from "@/lib/portfolio/privacy";
import type { BeforeToolEvent } from "../events";
import { dataTool, generalTool, testContext } from "../testing";
import { p3PersonalDataLeaving } from "./private-data";

const search = generalTool("web_search");

const privacy: PrivacySummary = {
  accountNames: ["Nemo Brokerage", "HSA"],
  quantities: [137, 100],
  costs: [41_250.75],
  symbols: ["NVDA"],
};

function searchFor(query: string): BeforeToolEvent {
  return { stage: "before_tool", toolName: "web_search", toolCallId: "call_1", args: { query }, tool: search };
}

describe("P3 personal data leaving", () => {
  it("blocks an account name in the arguments", () => {
    const verdict = p3PersonalDataLeaving(searchFor("Nemo Brokerage NVDA outlook"), testContext({ privacy }));

    expect(verdict?.kind).toBe("block");
    expect(verdict?.reason).toContain("Nemo Brokerage");
  });

  it("matches an account name whatever its case", () => {
    expect(p3PersonalDataLeaving(searchFor("nemo brokerage fees"), testContext({ privacy }))?.kind).toBe("block");
  });

  it("blocks a position size", () => {
    const verdict = p3PersonalDataLeaving(searchFor("is 137 shares of NVDA too much"), testContext({ privacy }));

    expect(verdict?.kind).toBe("block");
    expect(verdict?.figures).toEqual(["137"]);
  });

  it("blocks a cost basis", () => {
    const verdict = p3PersonalDataLeaving(searchFor("NVDA at 41,250.75 cost"), testContext({ privacy }));

    expect(verdict?.kind).toBe("block");
  });

  it("allows a round quantity that any question could contain", () => {
    expect(p3PersonalDataLeaving(searchFor("NVDA 100 day moving average"), testContext({ privacy }))).toBeUndefined();
  });

  it("allows a search that carries none of the holdings", () => {
    expect(p3PersonalDataLeaving(searchFor("NVDA data centre revenue"), testContext({ privacy }))).toBeUndefined();
  });

  it("ignores a short account name that would match prose", () => {
    expect(p3PersonalDataLeaving(searchFor("hsa contribution limits"), testContext({ privacy }))).toBeUndefined();
  });

  it("does nothing without a privacy summary", () => {
    expect(p3PersonalDataLeaving(searchFor("Nemo Brokerage NVDA"), testContext())).toBeUndefined();
  });

  it("does nothing for a tool that stays on the machine", () => {
    const edgar = dataTool("edgar_filings", { id: "edgar", name: "SEC EDGAR", tier: 1, coverage: ["filings"] });
    const event: BeforeToolEvent = {
      stage: "before_tool",
      toolName: "edgar_filings",
      toolCallId: "call_2",
      args: { query: "Nemo Brokerage" },
      tool: edgar,
    };

    expect(p3PersonalDataLeaving(event, testContext({ privacy }))).toBeUndefined();
  });
});
