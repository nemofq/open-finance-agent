import { describe, expect, it } from "vitest";
import { testLedger } from "./testing";
import { checkMessage, RULE_TITLES, summarizeChecks } from "./summary";
import type { CheckRecord } from "./types";

function check(overrides: Partial<CheckRecord>): CheckRecord {
  return {
    id: "chk_1",
    rule: "P8",
    kind: "flag",
    reason: "",
    timestamp: 0,
    stage: "before_stop",
    mode: "enforce",
    enforced: true,
    ...overrides,
  };
}

describe("summarizeChecks", () => {
  it("counts the ledger and what the checks found", () => {
    const ledger = testLedger();
    ledger.add({
      kind: "E",
      summary: "income statement",
      source: { id: "edgar", name: "SEC EDGAR", tier: 1 },
      conflicts: [{ with: "E2", metric: "revenue", period: "FY26 Q2", value: 1, otherValue: 2, agree: false }],
    });
    ledger.add({ kind: "E", summary: "vendor income statement" });
    ledger.add({ kind: "C", summary: "margin", value: 0.746 });
    ledger.add({ kind: "A", summary: "hurdle rate", value: 0.08 });
    ledger.add({ kind: "U", summary: "holding", value: 137 });
    ledger.add({ kind: "R", summary: "report" });

    const footer = summarizeChecks(
      [
        check({ rule: "P8", kind: "follow_up", figures: ["74.6%", "$12.3B"] }),
        check({ id: "chk_2", rule: "P9", kind: "flag", figures: ["4.4%"] }),
        check({ id: "chk_3", rule: "P1", kind: "block" }),
        check({ id: "chk_4", rule: "P2", kind: "serve" }),
      ],
      ledger.list(),
    );

    expect(footer).toEqual({
      figures: 5,
      retrieved: 2,
      computed: 1,
      assumed: 1,
      userProvided: 1,
      unsourced: 2,
      conflicts: 1,
      unverified: 1,
      flags: [expect.objectContaining({ rule: "P9" })],
      blocks: 1,
      served: 1,
      followUps: 1,
    });
  });

  it("counts nothing as acted on in observe mode", () => {
    const checks = [
      check({ rule: "P1", kind: "block", mode: "observe", enforced: false }),
      check({ id: "chk_2", rule: "P8", kind: "follow_up", mode: "observe", enforced: false }),
      check({ id: "chk_3", rule: "P11", kind: "flag", mode: "observe", enforced: false }),
    ];
    const footer = summarizeChecks(checks, []);

    expect(footer.blocks).toBe(0);
    expect(footer.followUps).toBe(0);
    // A flag only ever produces a record, so it is still the honest answer to what was found.
    expect(footer.flags).toHaveLength(1);
  });

  it("wraps a check for the transcript", () => {
    const record = check({ rule: "P11", timestamp: 1_757_000_000_000 });

    expect(checkMessage(record)).toEqual({ role: "check", check: record, timestamp: 1_757_000_000_000 });
  });

  it("names every rule", () => {
    expect(Object.keys(RULE_TITLES)).toHaveLength(13);
    expect(RULE_TITLES.P1).toBe("Trusted sources first");
  });
});
