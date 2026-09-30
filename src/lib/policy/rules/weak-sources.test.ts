import { describe, expect, it } from "vitest";
import type { BeforeStopEvent } from "../events";
import { testContext, testLedger } from "../testing";
import { p9UnverifiedFigures } from "./weak-sources";

function stop(text: string): BeforeStopEvent {
  return { stage: "before_stop", text, request: "" };
}

describe("P9 figures backed only by the open web", () => {
  it("flags a figure whose only source is tier 4", () => {
    const ledger = testLedger();
    ledger.add({
      kind: "E",
      summary: "blog post on MicroStrategy",
      source: { id: "web", name: "example.com", tier: 4 },
      numbers: [{ value: 4.4, unit: "%", context: "4.4% of all bitcoin" }],
    });
    const verdict = p9UnverifiedFigures(stop("It holds 4.4% of all bitcoin."), testContext({ ledger }));

    expect(verdict?.kind).toBe("flag");
    expect(verdict?.figures).toEqual(["4.4%"]);
    expect(verdict?.reason).toContain("unverified");
  });

  it("says nothing when a primary source also holds the figure", () => {
    const ledger = testLedger();
    ledger.add({
      kind: "E",
      summary: "blog post",
      source: { id: "web", name: "example.com", tier: 4 },
      numbers: [{ value: 4.4, unit: "%", context: "4.4%" }],
    });
    ledger.add({
      kind: "E",
      summary: "EDGAR filing",
      source: { id: "edgar", name: "SEC EDGAR", tier: 1 },
      numbers: [{ value: 4.4, unit: "%", context: "4.4%" }],
    });

    expect(p9UnverifiedFigures(stop("It holds 4.4% of all bitcoin."), testContext({ ledger }))).toBeUndefined();
  });

  it("says nothing about a figure no entry holds, which is P8's job", () => {
    expect(p9UnverifiedFigures(stop("It holds 4.4% of all bitcoin."), testContext())).toBeUndefined();
  });

  it("does not treat a computed figure as unverified", () => {
    const ledger = testLedger();
    ledger.add({ kind: "C", summary: "share of supply", name: "share", value: 4.4, unit: "%" });

    expect(p9UnverifiedFigures(stop("It holds 4.4% of all bitcoin."), testContext({ ledger }))).toBeUndefined();
  });
});
