import { describe, expect, it } from "vitest";
import type { CheckRecord } from "@/lib/policy/types";
import { entriesOf, footerOf } from "./evidence";
import { buildTranscript, type MessagePart } from "./transcript";
import { call, entry, record } from "./transcript.fixture";

describe("entriesOf", () => {
  const part = (details: unknown): MessagePart => ({ kind: "tool", id: "t1", name: "edgar_facts", args: {}, details });

  it("reads a single entry and a list of them", () => {
    expect(entriesOf(part({ evidence: entry({ id: "E1", kind: "E" }) })).map((found) => found.id)).toEqual(["E1"]);
    expect(
      entriesOf(part({ evidence: [entry({ id: "E1", kind: "E" }), entry({ id: "C2", kind: "C" })] })).map(
        (found) => found.id,
      ),
    ).toEqual(["E1", "C2"]);
  });

  it("rejects details that carry no valid entry", () => {
    expect(entriesOf(part(undefined))).toEqual([]);
    expect(entriesOf(part("oops"))).toEqual([]);
    expect(entriesOf(part({ title: "Q3" }))).toEqual([]);
    expect(entriesOf(part({ evidence: [{ id: "X1", kind: "X" }] }))).toEqual([]);
    expect(entriesOf(part({ evidence: [{ id: "E1", kind: "C" }] }))).toEqual([]);
    expect(entriesOf(part({ evidence: ["E1"] }))).toEqual([]);
    expect(entriesOf({ kind: "text", text: "hi" })).toEqual([]);
  });
});

describe("footerOf", () => {
  const conflicted = entry({
    id: "E2",
    kind: "E",
    conflicts: [
      { with: "E1", metric: "revenue", period: "FY25 Q2", value: 30_040, otherValue: 31_000, agree: false },
    ],
  });

  const items = buildTranscript([
    ...call("t1", "edgar_facts", [entry({ id: "E1", kind: "E" }), conflicted]),
    // The same entry served again from the ledger (P2); it must not be counted twice.
    ...call("t2", "edgar_facts", [entry({ id: "E1", kind: "E" }), entry({ id: "U1", kind: "U" })]),
    ...call("t3", "financial_calculator", [entry({ id: "C1", kind: "C" }), entry({ id: "A1", kind: "A" })]),
    ...call("t4", "create_report", entry({ id: "R1", kind: "R" })),
  ]);

  it("counts the ledger's composition, deduplicated and without the report stubs", () => {
    const footer = footerOf(items, []);
    expect(footer).toMatchObject({ figures: 5, retrieved: 2, computed: 1, assumed: 1, userProvided: 1 });
    expect(footer.entries.map((found) => found.id)).toEqual(["E1", "E2", "C1", "A1", "U1", "R1"]);
  });

  it("counts entries that disagree with another entry", () => {
    expect(footerOf(items, []).conflicts).toBe(1);
  });

  it("takes unsourced and unverified from the distinct figures P8 and P9 named", () => {
    const checks: CheckRecord[] = [
      record({ rule: "P8", kind: "follow_up", figures: ["4.4%", "1.7%"] }),
      record({ rule: "P8", kind: "flag", figures: ["4.4%"] }),
      record({ rule: "P9", kind: "flag", figures: ["$3.2B"] }),
    ];
    const footer = footerOf(items, checks);
    expect(footer.unsourced).toBe(2);
    expect(footer.unverified).toBe(1);
    expect(footer.flags.map((record) => record.rule)).toEqual(["P8", "P9"]);
  });

  it("counts blocks, served calls and follow-ups only where they took effect", () => {
    const checks: CheckRecord[] = [
      record({ rule: "P1", kind: "block" }),
      record({ rule: "P1", kind: "block", enforced: false, mode: "observe" }),
      record({ rule: "P2", kind: "serve" }),
      record({ rule: "P2", kind: "serve", enforced: false }),
      record({ rule: "P8", kind: "follow_up" }),
      record({ rule: "P8", kind: "follow_up", enforced: false }),
    ];
    expect(footerOf(items, checks)).toMatchObject({ blocks: 1, served: 1, followUps: 1 });
  });

  it("is all zeroes for a chat with no evidence and no checks", () => {
    expect(footerOf([], [])).toMatchObject({ figures: 0, unsourced: 0, conflicts: 0, flags: [], entries: [] });
  });
});
