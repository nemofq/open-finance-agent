import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { StoredAttachment, StoredImage } from "@/lib/attachments/types";
import { resolveContextBudget } from "./budget";
import { currentTurnStart, stubBefore, stubOldResults } from "./stubs";
import { assistant, entry, fakeModel, toolResult, user } from "./testing";
import type { ContextBudget } from "./types";
import { ledgerWith } from "@/lib/evidence/testing";

/** A budget that stubs as soon as anything is in the transcript, so fixtures stay readable. */
const budget: ContextBudget = { ...resolveContextBudget(fakeModel(32_768)), stubAt: 100 };

const prices = entry("E12", {
  summary: "Alpha Vantage daily prices, $NVDA, 60 rows",
  source: { id: "alphavantage", name: "Alpha Vantage", tier: 2 },
  asOf: "2026-09-11",
  toolCallId: "call-1",
});
const report = entry("R1", { summary: "Nvidia earnings review", toolCallId: "call-2" });

const bigText = "close 178.24 ".repeat(200);

function transcript(): AgentMessage[] {
  return [
    user("How did $NVDA do?"),
    assistant({ thinking: "let me fetch prices", calls: [{ id: "call-1", name: "av_prices", arguments: { symbol: "NVDA" } }] }),
    toolResult("call-1", "av_prices", bigText, prices),
    assistant({ text: "It rose.", calls: [{ id: "call-2", name: "create_report", arguments: { spec: bigText } }] }),
    toolResult("call-2", "create_report", "Report created", report),
    user("And the quarter?"),
    assistant({ calls: [{ id: "call-3", name: "edgar_income", arguments: { cik: "1045810" } }] }),
    toolResult("call-3", "edgar_income", bigText, entry("E13", { summary: "EDGAR income statement", toolCallId: "call-3" })),
  ];
}

const textOf = (message: AgentMessage): string =>
  message.role === "toolResult" ? message.content.map((block) => (block.type === "text" ? block.text : "")).join("") : "";

describe("stubOldResults", () => {
  const ledger = () => ledgerWith([prices, report]);

  it("does nothing while the context is small", () => {
    const messages = transcript();
    const roomy = { ...budget, stubAt: 1_000_000 };
    expect(stubOldResults(messages, { ledger: ledger(), budget: roomy, currentTurnStart: 5 })).toBe(messages);
  });

  it("replaces older results with their evidence line and leaves the current turn alone", () => {
    const messages = transcript();
    const out = stubOldResults(messages, { ledger: ledger(), budget, currentTurnStart: currentTurnStart(messages) });

    expect(textOf(out[2])).toBe(
      "[E12 · Alpha Vantage · tier 2 · as of 2026-09-11] Alpha Vantage daily prices, $NVDA, 60 rows" +
        " (stubbed; evidence_get E12 for values)",
    );
    expect(textOf(out[7])).toBe(bigText);
  });

  it("replaces a report's arguments with its R id and drops old thinking", () => {
    const out = stubOldResults(transcript(), { ledger: ledger(), budget, currentTurnStart: 5 });

    const planning = out[1];
    expect(planning.role === "assistant" && planning.content.some((block) => block.type === "thinking")).toBe(false);
    const writing = out[3];
    const call = writing.role === "assistant" ? writing.content.find((block) => block.type === "toolCall") : undefined;
    expect(call?.type === "toolCall" && call.arguments).toEqual({ spec: "<R1 stub>" });
  });

  it("keeps a disagreement visible in the stub, since the values themselves are gone", () => {
    const disputed = entry("E12", {
      summary: "Alpha Vantage daily prices, $NVDA, 60 rows",
      source: { id: "alphavantage", name: "Alpha Vantage", tier: 2 },
      asOf: "2026-09-11",
      toolCallId: "call-1",
      conflicts: [{ with: "E3", metric: "revenue", period: "FY26 Q2", value: 1, otherValue: 2, agree: false }],
    });
    const out = stubOldResults(transcript(), {
      ledger: ledgerWith([disputed, report]),
      budget,
      currentTurnStart: 5,
    });

    expect(textOf(out[2])).toContain("(conflicts with E3)");
  });

  it("trims a result the ledger never saw instead of pointing at an id that does not exist", () => {
    const messages: AgentMessage[] = [
      user("remind me"),
      assistant({ calls: [{ id: "m1", name: "memory_read", arguments: {} }] }),
      toolResult("m1", "memory_read", bigText),
      user("thanks"),
    ];
    const out = stubOldResults(messages, { ledger: ledgerWith(), budget, currentTurnStart: 3 });

    expect(textOf(out[2])).toContain("(older result trimmed)");
    expect(textOf(out[2]).length).toBeLessThan(bigText.length);
    expect(textOf(out[2])).not.toContain("evidence_get");
  });

  it("never mutates the transcript it was given", () => {
    const messages = transcript();
    const before = JSON.stringify(messages);
    stubOldResults(messages, { ledger: ledger(), budget, currentTurnStart: 5 });
    expect(JSON.stringify(messages)).toBe(before);
  });

  it("stubs in one batch, so the cached prefix does not shift as the chat grows", () => {
    const first = stubOldResults(transcript(), { ledger: ledger(), budget, currentTurnStart: 5 });
    const later = [...transcript(), user("anything else?"), assistant({ text: "no" })];
    const second = stubOldResults(later, { ledger: ledger(), budget, currentTurnStart: 5 });

    expect(second.slice(0, 5).map(textOf)).toEqual(first.slice(0, 5).map(textOf));
  });
});

describe("stubBefore, on images", () => {
  const attached = (name: string): StoredImage => ({ type: "image", data: "", mimeType: "image/png", attachment: name, bytes: 4096 });
  const shot = attached(`${"a".repeat(40)}.png`);
  const chart = attached(`${"b".repeat(40)}.png`);

  it("replaces an image from an earlier turn with a note naming its file", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "what is this?" }, shot], timestamp: 1 },
      assistant({ text: "A price chart." }),
      user("and the quarter?"),
    ];
    const out = stubBefore(messages, 2, ledgerWith());

    expect(out[0]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "what is this?" },
        { type: "text", text: `(image from an earlier turn: ${shot.attachment})` },
      ],
      timestamp: 1,
    });
  });

  it("drops a skill turn's images into its prompt, so the conversion stays one shape", () => {
    const messages: AgentMessage[] = [
      { role: "skill", skill: "earnings-review", request: "", prompt: "Run an earnings review.", images: [shot, chart], timestamp: 1 },
      assistant({ text: "Done." }),
    ];
    const out = stubBefore(messages, 1, ledgerWith());
    const stubbed = out[0];

    expect(stubbed.role === "skill" && stubbed.images).toBeUndefined();
    expect(stubbed.role === "skill" && stubbed.prompt).toBe(
      `Run an earnings review.\n\n(image from an earlier turn: ${shot.attachment})\n(image from an earlier turn: ${chart.attachment})`,
    );
  });

  it("leaves the current turn's images where the model can still see them", () => {
    const messages: AgentMessage[] = [
      user("earlier"),
      { role: "user", content: [{ type: "text", text: "what is this?" }, shot], timestamp: 2 },
    ];
    const out = stubBefore(messages, currentTurnStart(messages), ledgerWith());
    expect(out[1]).toBe(messages[1]);
  });

  it("leaves a message with no attachment exactly as it was", () => {
    const messages: AgentMessage[] = [
      user("plain text"),
      { role: "user", content: [{ type: "image", data: "abc", mimeType: "image/png" }], timestamp: 2 },
      assistant({ text: "hm" }),
    ];
    const out = stubBefore(messages, 2, ledgerWith());
    expect(out[0]).toBe(messages[0]);
    expect(out[1]).toBe(messages[1]);
  });
});

describe("stubBefore, on documents", () => {
  const memo: StoredAttachment = {
    attachment: `${"c".repeat(40)}.docx`,
    name: "Q3 memo.docx",
    kind: "document",
    bytes: 40_000,
    tokens: 8_412,
    parts: 12,
  };
  const book: StoredAttachment = { ...memo, attachment: `${"d".repeat(40)}.csv`, name: "holdings.csv", kind: "table", parts: 1 };
  const note = `(attachment from an earlier turn: Q3 memo.docx, 12 parts, ~8k tokens \u2014 use read_attachment)`;

  it("replaces the inlined file with a note saying how to read it again", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: [{ type: "text", text: "what does this say?" }], documents: [memo, book], timestamp: 1 },
      assistant({ text: "Revenue rose." }),
      user("and the quarter?"),
    ];
    const out = stubBefore(messages, 2, ledgerWith());
    const stubbed = out[0];

    // Dropping `documents` is what stops the hydration inlining the file all over again.
    expect(stubbed.role === "user" && stubbed.documents).toBeUndefined();
    expect(stubbed.role === "user" && Array.isArray(stubbed.content) ? stubbed.content : []).toEqual([
      { type: "text", text: "what does this say?" },
      { type: "text", text: note },
      { type: "text", text: "(attachment from an earlier turn: holdings.csv, 1 sheet, ~8k tokens \u2014 use read_attachment)" },
    ]);
  });

  it("drops a skill turn's documents into its prompt, so the conversion stays one shape", () => {
    const messages: AgentMessage[] = [
      { role: "skill", skill: "earnings-review", request: "", prompt: "Run it.", documents: [memo], timestamp: 1 },
      assistant({ text: "Done." }),
    ];
    const stubbed = stubBefore(messages, 1, ledgerWith())[0];

    expect(stubbed.role === "skill" && stubbed.documents).toBeUndefined();
    expect(stubbed.role === "skill" && stubbed.prompt).toBe(`Run it.\n\n${note}`);
  });

  it("leaves the current turn's file where the model can still read it", () => {
    const messages: AgentMessage[] = [
      user("earlier"),
      { role: "user", content: [{ type: "text", text: "read this" }], documents: [memo], timestamp: 2 },
    ];
    expect(stubBefore(messages, currentTurnStart(messages), ledgerWith())[1]).toBe(messages[1]);
  });
});

describe("currentTurnStart", () => {
  it("points at the last user message", () => {
    expect(currentTurnStart(transcript())).toBe(5);
  });

  it("points past the end when nothing has been asked yet", () => {
    expect(currentTurnStart([])).toBe(0);
  });
});
