import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import type { StoredAttachment, StoredImage } from "@/lib/attachments/types";
import { evidenceIndex, evidenceIndexBudget, serializeForSummary } from "./serialize";
import { assistant, entry, toolResult, user } from "./testing";
import { ledgerWith } from "@/lib/evidence/testing";

const skill = (name: string, prompt: string): AgentMessage => ({
  role: "skill",
  skill: name,
  request: "for $NVDA",
  prompt,
  timestamp: 1,
});

describe("serializeForSummary", () => {
  it("keeps what a checkpoint has to quote, including a skill turn", () => {
    const text = serializeForSummary([
      user("How did $NVDA do?"),
      skill("earnings-review", "Run an earnings review for $NVDA"),
      assistant({ thinking: "private", text: "Fetching.", calls: [{ id: "c1", name: "edgar_income", arguments: { cik: "1045810" } }] }),
      toolResult("c1", "edgar_income", "[E7 · SEC EDGAR · tier 1] income statement (stubbed)"),
    ]);

    expect(text).toContain("[User]: How did $NVDA do?");
    expect(text).toContain("[User /earnings-review]: Run an earnings review for $NVDA");
    expect(text).toContain("[Assistant]: Fetching.");
    expect(text).toContain('[Assistant tool calls]: edgar_income(cik="1045810")');
    expect(text).toContain("[Tool result edgar_income]: [E7 · SEC EDGAR · tier 1] income statement (stubbed)");
    expect(text).not.toContain("private");
  });

  it("notes that a turn had an image in it, on both a plain message and a skill turn", () => {
    const attached: StoredImage = { type: "image", data: "", mimeType: "image/png", attachment: `${"a".repeat(40)}.png`, bytes: 99 };
    const text = serializeForSummary([
      { role: "user", content: [{ type: "text", text: "what is this chart saying?" }, attached], timestamp: 1 },
      { role: "skill", skill: "earnings-review", request: "", prompt: "Run an earnings review for $NVDA", images: [attached, attached], timestamp: 2 },
      toolResult("c1", "chart_render", "rendered"),
    ]);

    expect(text).toContain("[User]: what is this chart saying?\n[image attached]");
    expect(text).toContain("[User /earnings-review]: Run an earnings review for $NVDA\n[image attached]\n[image attached]");
  });

  it("names a file a turn carried, so a later turn knows it can be read again", () => {
    const memo: StoredAttachment = {
      attachment: `${"c".repeat(40)}.docx`,
      name: "Q3 memo.docx",
      kind: "document",
      bytes: 40_000,
      tokens: 8_412,
      parts: 12,
    };
    const text = serializeForSummary([
      { role: "user", content: [{ type: "text", text: "what does this say?" }], documents: [memo], timestamp: 1 },
      { role: "skill", skill: "earnings-review", request: "", prompt: "Run it.", documents: [memo], timestamp: 2 },
    ]);

    expect(text).toContain("[User]: what does this say?\n[attached: Q3 memo.docx]");
    expect(text).toContain("[User /earnings-review]: Run it.\n[attached: Q3 memo.docx]");
  });

  it("records an enforcement decision the checkpoint should carry forward", () => {
    const text = serializeForSummary([
      {
        role: "check",
        check: {
          id: "k1",
          rule: "P8",
          kind: "follow_up",
          reason: "Two figures in the answer had no source",
          timestamp: 1,
          stage: "before_stop",
          mode: "enforce",
          enforced: true,
        },
        timestamp: 1,
      },
    ]);
    expect(text).toBe("[Check P8 follow_up]: Two figures in the answer had no source");
  });
});

describe("evidenceIndex", () => {
  const entries = [
    entry("E7", { summary: "EDGAR income statement", source: { id: "edgar", name: "SEC EDGAR", tier: 1 }, asOf: "2026-08-27" }),
    entry("C3", { summary: "P/E on trailing earnings", value: 28.4 }),
  ];

  it("lists every id with its source and value", () => {
    const text = evidenceIndex(ledgerWith(entries), 1_000);
    expect(text).toContain("[E7 · SEC EDGAR · tier 1 · as of 2026-08-27] EDGAR income statement");
    expect(text).toContain("P/E on trailing earnings = 28.4");
  });

  it("keeps the newest entries when they do not all fit, and says how many it dropped", () => {
    const many = Array.from({ length: 50 }, (_, i) => entry(`E${i + 1}`, { summary: `entry ${i + 1} `.repeat(10) }));
    const text = evidenceIndex(ledgerWith(many), 100);

    expect(text).toContain("earlier entries omitted (evidence_get)");
    expect(text).toContain("[E50");
    expect(text).not.toContain("[E1 ");
  });

  it("says so plainly when nothing has been fetched", () => {
    expect(evidenceIndex(ledgerWith(), 100)).toBe("(no evidence recorded)");
  });
});

describe("evidenceIndexBudget", () => {
  it("scales with the window, within a floor and a ceiling", () => {
    expect(evidenceIndexBudget(32_768)).toBe(4_000);
    expect(evidenceIndexBudget(4_000)).toBe(600);
    expect(evidenceIndexBudget(1_000)).toBe(500);
  });
});
