import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import type { CheckRecord } from "@/lib/policy/types";
import type { StoredAttachment, StoredImage } from "@/lib/attachments/types";
import {
  appendChecks,
  appendDelta,
  buildTranscript,
  type ChatItem,
  isReportPart,
  type MessagePart,
  reportsOf,
  reviseAnswer,
  endThinking,
  thoughtLabel,
} from "./transcript";
import { assistant, call, entry, record } from "./transcript.fixture";

/** A saved attachment block; typed here because a user turn's content only knows `ImageContent`. */
const image = (attachment: string, size?: { width: number; height: number }): StoredImage => ({
  type: "image",
  data: "",
  mimeType: "image/png",
  attachment,
  bytes: 2048,
  ...size,
});

/** A parsed document, as the turn that sent it keeps it. */
const memo: StoredAttachment = {
  attachment: "abc.docx",
  name: "Q3 memo.docx",
  kind: "document",
  bytes: 4096,
  tokens: 8_000,
  parts: 1,
};

describe("buildTranscript", () => {
  it("keeps thinking, tool calls and text in streamed order", () => {
    const items = buildTranscript([
      assistant([
        { type: "thinking", thinking: "check filings" },
        { type: "toolCall", id: "t1", name: "edgar_filings", arguments: { ticker: "AAPL" } },
        { type: "text", text: "Here you go." },
      ]),
    ]);
    expect(items[0].role).toBe("assistant");
    expect(items[0].role === "assistant" && items[0].parts.map((part) => part.kind)).toEqual([
      "thinking",
      "tool",
      "text",
    ]);
  });

  it("folds tool results into their tool call", () => {
    const items = buildTranscript([
      assistant([{ type: "toolCall", id: "t1", name: "quote", arguments: {} }]),
      { role: "toolResult", toolCallId: "t1", toolName: "quote", content: [{ type: "text", text: "204.3" }], isError: false, timestamp: 0 },
    ]);
    const part = items[0].role === "assistant" ? items[0].parts[0] : null;
    expect(part).toMatchObject({ kind: "tool", result: "204.3", isError: false });
  });

  it("uses live tool outcomes before the tool result message arrives", () => {
    const items = buildTranscript(
      [assistant([{ type: "toolCall", id: "t1", name: "quote", arguments: {} }])],
      [],
      { t1: { result: "pending result", isError: true } },
    );
    const part = items[0].role === "assistant" ? items[0].parts[0] : null;
    expect(part).toMatchObject({ result: "pending result", isError: true });
  });

  it("leaves a running tool without a result", () => {
    const items = buildTranscript([assistant([{ type: "toolCall", id: "t1", name: "quote", arguments: {} }])]);
    const part = items[0].role === "assistant" ? items[0].parts[0] : null;
    expect(part).toEqual({ kind: "tool", id: "t1", name: "quote", args: {} });
  });

  it("renders user messages and appends the live turn last", () => {
    const items = buildTranscript(
      [{ role: "user", content: "hi", timestamp: 0 }],
      [{ kind: "text", text: "hel" }],
    );
    expect(items.map((item) => item.role)).toEqual(["user", "assistant"]);
    expect(items[1].role === "assistant" && items[1].streaming).toBe(true);
  });

  it("renders a skill turn as a user item carrying the chip and the typed request", () => {
    const items = buildTranscript([
      { role: "skill", skill: "earnings-review", request: "$AAPL", prompt: "<skill>…</skill>", timestamp: 0 },
    ]);
    expect(items).toEqual([{ key: "u0", role: "user", text: "$AAPL", skill: "earnings-review" }]);
  });

  it("gives a user turn's attachments a thumbnail each, beside the text", () => {
    const items = buildTranscript(
      [
        {
          role: "user",
          content: [
            { type: "text", text: "what does this chart say" },
            image("abc.png", { width: 64, height: 48 }),
          ],
          timestamp: 0,
        },
      ],
      [],
      {},
      "s1",
    );
    expect(items).toEqual([
      {
        key: "u0",
        role: "user",
        text: "what does this chart say",
        images: [
          {
            key: "u0:0",
            url: "/api/sessions/s1/attachments/abc.png",
            alt: "Attached image",
            width: 64,
            height: 48,
          },
        ],
      },
    ]);
  });

  it("carries a skill turn's attachments too", () => {
    const items = buildTranscript(
      [
        {
          role: "skill",
          skill: "earnings-review",
          request: "$AAPL",
          prompt: "<skill>…</skill>",
          images: [image("abc.png")],
          timestamp: 0,
        },
      ],
      [],
      {},
      "s1",
    );
    expect(items).toEqual([
      {
        key: "u0",
        role: "user",
        text: "$AAPL",
        skill: "earnings-review",
        images: [{ key: "u0:0", url: "/api/sessions/s1/attachments/abc.png", alt: "Attached image" }],
      },
    ]);
  });

  it("leaves the images field off a turn that carried none", () => {
    const items = buildTranscript([{ role: "user", content: "hi", timestamp: 0 }], [], {}, "s1");
    expect(items).toEqual([{ key: "u0", role: "user", text: "hi" }]);
  });

  it("carries a turn's documents as chips of their own", () => {
    const items = buildTranscript(
      [{ role: "user", content: "read this", documents: [memo], timestamp: 0 }],
      [],
      {},
      "s1",
    );
    expect(items).toEqual([
      {
        key: "u0",
        role: "user",
        text: "read this",
        documents: [
          {
            key: "u0:d0",
            document: memo,
            url: "/api/sessions/s1/attachments/abc.docx",
            textUrl: "/api/sessions/s1/attachments/abc.docx/text",
          },
        ],
      },
    ]);
  });

  it("drops assistant messages with no renderable content", () => {
    expect(buildTranscript([assistant([{ type: "text", text: "   " }])])).toEqual([]);
  });
});

describe("buildTranscript, drafts", () => {
  const check = (id: string, over: Partial<CheckRecord> = {}): CheckRecord => ({
    id,
    rule: "P8",
    kind: "follow_up",
    reason: "a figure had no entry behind it",
    text: "Register the figures, then answer again.",
    stage: "before_stop",
    mode: "enforce",
    enforced: true,
    timestamp: 7,
    ...over,
  });

  const checkMessage = (record: CheckRecord): AgentMessage => ({ role: "check", check: record, timestamp: 7 });

  it("renders an answer a follow-up sent back as a draft, with the revision after it", () => {
    const followUp = check("k1");
    const items = buildTranscript([
      assistant([{ type: "text", text: "margin was 18%" }]),
      checkMessage(followUp),
      assistant([{ type: "text", text: "margin was 18.2% [E1]" }]),
    ]);
    expect(items.map((item) => item.role)).toEqual(["draft", "assistant"]);
    expect(items[0]).toMatchObject({ role: "draft", check: followUp, parts: [{ kind: "text", text: "margin was 18%" }] });
  });

  it("keeps a cut-off draft that never wrote an answer", () => {
    const items = buildTranscript([
      assistant([{ type: "thinking", thinking: "…" }, { type: "text", text: "" }]),
      checkMessage(check("k1", { rule: "H1", reason: "The reply ran out of output" })),
      assistant([{ type: "text", text: "Here it is." }]),
    ]);
    expect(items.map((item) => item.role)).toEqual(["draft", "assistant"]);
    expect(items[0].role === "draft" && items[0].parts.map((part) => part.kind)).toEqual(["thinking"]);
  });

  it("leaves an answer that stood alone with its checks footer", () => {
    const items = buildTranscript([
      assistant([{ type: "text", text: "done" }]),
      checkMessage(check("k1", { rule: "P6", kind: "annotate" })),
    ]);
    expect(items.map((item) => item.role)).toEqual(["assistant", "checks"]);
  });

  it("collapses each of two rounds of revision, leaving one answer", () => {
    const items = buildTranscript([
      assistant([{ type: "text", text: "first" }]),
      checkMessage(check("k1")),
      assistant([{ type: "text", text: "second" }]),
      checkMessage(check("k2", { rule: "delivery", reason: "no report was created" })),
      assistant([{ type: "text", text: "third" }]),
      checkMessage(check("k3", { rule: "P6", kind: "annotate" })),
    ]);
    expect(items.map((item) => item.role)).toEqual(["draft", "draft", "assistant", "checks"]);
    expect(items[3].role === "checks" && items[3].checks.map((entry) => entry.id)).toEqual(["k3"]);
  });
});

describe("reviseAnswer", () => {
  const question: AgentMessage = { role: "user", content: "How did revenue move?", timestamp: 1 };

  it("replaces the text of the turn's last assistant message", () => {
    const messages: AgentMessage[] = [
      question,
      assistant([{ type: "toolCall", id: "c1", name: "quote", arguments: {} }]),
      assistant([
        { type: "thinking", thinking: "compare the quarters" },
        { type: "text", text: "Revenue rose 8% {E7}." },
        { type: "text", text: " More soon." },
      ]),
      { role: "check", check: { id: "k1", rule: "P8", kind: "follow_up", reason: "", stage: "before_stop", mode: "enforce", enforced: false, timestamp: 7 }, timestamp: 7 },
    ];
    const next = reviseAnswer(messages, "Revenue rose 8% [1].");
    expect(next[2]).toMatchObject({
      role: "assistant",
      content: [
        { type: "thinking", thinking: "compare the quarters" },
        { type: "text", text: "Revenue rose 8% [1]." },
      ],
    });
    expect(next[1]).toBe(messages[1]);
    expect(next[3]).toBe(messages[3]);
    expect(messages[2]).toMatchObject({ content: [{ type: "thinking" }, { text: "Revenue rose 8% {E7}." }, { text: " More soon." }] });
  });

  it("ignores a turn whose answer is not on screen yet", () => {
    const earlier = assistant([{ type: "text", text: "An older answer." }]);
    const messages: AgentMessage[] = [earlier, question];
    expect(reviseAnswer(messages, "revised")).toBe(messages);
    expect(reviseAnswer([], "revised")).toEqual([]);
  });
});

describe("appendChecks", () => {
  const check = (id: string): CheckRecord => ({
    id,
    rule: "P8",
    kind: "follow_up",
    reason: "a figure had no entry behind it",
    stage: "before_stop",
    mode: "enforce",
    enforced: true,
    timestamp: 7,
  });

  it("puts the turn's checks after the answer", () => {
    const messages: AgentMessage[] = [assistant([{ type: "text", text: "done" }])];
    const next = appendChecks(messages, [check("k1"), check("k2")]);
    expect(next.map((message) => message.role)).toEqual(["assistant", "check", "check"]);
    expect(next[1]).toEqual({ role: "check", check: check("k1"), timestamp: 7 });
  });

  it("skips checks the transcript already carries", () => {
    const messages: AgentMessage[] = [{ role: "check", check: check("k1"), timestamp: 7 }];
    expect(appendChecks(messages, [check("k1")])).toBe(messages);
    expect(appendChecks(messages, [check("k1"), check("k2")])).toHaveLength(2);
  });

  it("returns the same array when there is nothing to add", () => {
    const messages: AgentMessage[] = [];
    expect(appendChecks(messages, [])).toBe(messages);
  });
});

describe("appendDelta", () => {
  it("extends the trailing part of the same kind", () => {
    const parts: MessagePart[] = [{ kind: "text", text: "he" }];
    expect(appendDelta(parts, "text", "llo")).toEqual([{ kind: "text", text: "hello" }]);
  });

  it("starts a new part when the kind changes", () => {
    const parts: MessagePart[] = [{ kind: "thinking", text: "hm" }];
    expect(appendDelta(parts, "text", "hi")).toEqual([
      { kind: "thinking", text: "hm" },
      { kind: "text", text: "hi" },
    ]);
  });
});

/** A settled `create_report` call and its result, the rendered HTML on the result's details. */
const reportTurn = (id: string, title: string, timestamp = 0): AgentMessage[] => [
  assistant([{ type: "toolCall", id, name: "create_report", arguments: { title, sections: [] } }]),
  {
    role: "toolResult",
    toolCallId: id,
    toolName: "create_report",
    content: [{ type: "text", text: "ok" }],
    details: { title, format: "doc", html: `<p>${title}</p>` },
    isError: false,
    timestamp,
  },
];

describe("reportsOf", () => {
  it("collects create_report calls in order, numbered", () => {
    const items = buildTranscript([
      ...reportTurn("t1", "Q3"),
      assistant([{ type: "toolCall", id: "t2", name: "quote", arguments: {} }]),
      ...reportTurn("t3", "Q4"),
    ]);
    expect(reportsOf(items)).toEqual([
      { id: "t1", title: "Q3", html: "<p>Q3</p>", format: "doc", createdAt: 0, ordinal: 1 },
      { id: "t3", title: "Q4", html: "<p>Q4</p>", format: "doc", createdAt: 0, ordinal: 2 },
    ]);
  });

  it("skips a report whose tool call failed", () => {
    const items = buildTranscript(
      [assistant([{ type: "toolCall", id: "t1", name: "create_report", arguments: { title: "Q3", sections: [] } }])],
      [],
      { t1: { result: "html too large", isError: true } },
    );
    expect(reportsOf(items)).toEqual([]);
  });

  it("takes the time from the tool result, not the turn that asked for it", () => {
    expect(reportsOf(buildTranscript(reportTurn("t1", "Q3", 4000)))[0].createdAt).toBe(4000);
  });
});

describe("isReportPart", () => {
  it("matches only the report tool", () => {
    expect(isReportPart({ kind: "tool", id: "t1", name: "create_report", args: {} })).toBe(true);
    expect(isReportPart({ kind: "tool", id: "t2", name: "quote", args: {} })).toBe(false);
    expect(isReportPart({ kind: "text", text: "hi" })).toBe(false);
  });
});

/* ---------------------------------------------------------------- checks */

const check = (fields: Partial<CheckRecord> & Pick<CheckRecord, "rule" | "kind">): AgentMessage => ({
  role: "check",
  check: record(fields),
  timestamp: 0,
});

const checksItem = (items: ChatItem[]): Extract<ChatItem, { role: "checks" }> | null =>
  items.find((item) => item.role === "checks") ?? null;

describe("buildTranscript, checks and compaction", () => {
  it("groups one turn's consecutive checks into a single footer after the answer", () => {
    const items = buildTranscript([
      { role: "user", content: "How did revenue do?", timestamp: 0 },
      assistant([{ type: "text", text: "It rose 8%." }]),
      check({ rule: "P8", kind: "flag", figures: ["8%"] }),
      check({ rule: "P11", kind: "flag" }),
    ]);
    expect(items.map((item) => item.role)).toEqual(["user", "assistant", "checks"]);
    const footer = checksItem(items);
    expect(footer?.key).toBe("c2");
    expect(footer?.checks.map((record) => record.rule)).toEqual(["P8", "P11"]);
    expect(footer?.footer.unsourced).toBe(1);
  });

  it("skips a saved check whose rule this build does not know", () => {
    // A record written under a rule id that has since been retired, as an older build saved it.
    const retired = (kind: CheckRecord["kind"]) => check({ ...record({ rule: "P8", kind }), rule: "P99" as CheckRecord["rule"] });
    const items = buildTranscript([
      { role: "user", content: "How did revenue do?", timestamp: 0 },
      assistant([{ type: "text", text: "It rose 8%." }]),
      retired("follow_up"),
      check({ rule: "P11", kind: "flag" }),
      retired("flag"),
    ]);
    expect(items.map((item) => item.role)).toEqual(["user", "assistant", "checks"]);
    expect(checksItem(items)?.checks.map((record) => record.rule)).toEqual(["P11"]);
  });

  it("gives each turn its own footer", () => {
    const items = buildTranscript([
      assistant([{ type: "text", text: "One." }]),
      check({ rule: "P8", kind: "flag" }),
      { role: "user", content: "and again?", timestamp: 0 },
      assistant([{ type: "text", text: "Two." }]),
      check({ rule: "P9", kind: "flag" }),
    ]);
    expect(items.map((item) => item.role)).toEqual(["assistant", "checks", "user", "assistant", "checks"]);
    expect(items.map((item) => item.key)).toEqual(["a0", "c1", "u2", "a3", "c4"]);
  });

  it("counts every entry seen before the checks, not only the last turn's", () => {
    const items = buildTranscript([
      ...call("t1", "edgar_facts", entry({ id: "E1", kind: "E" })),
      check({ rule: "P8", kind: "flag" }),
      ...call("t2", "financial_calculator", entry({ id: "C1", kind: "C" })),
      check({ rule: "P8", kind: "flag" }),
    ]);
    const footers = items.filter((item) => item.role === "checks");
    expect(footers.map((item) => item.role === "checks" && item.footer.figures)).toEqual([1, 2]);
  });

  it("renders a compaction message as a divider, keeping the history above it", () => {
    const items = buildTranscript([
      assistant([{ type: "text", text: "Earlier work." }]),
      {
        role: "compaction",
        summary: "Checkpoint",
        tokensBefore: 120_000,
        tokensAfter: 30_000,
        evidenceIds: ["E1"],
        timestamp: 0,
      },
      assistant([{ type: "text", text: "Carrying on." }]),
    ]);
    expect(items.map((item) => item.role)).toEqual(["assistant", "compaction", "assistant"]);
    expect(items[1]).toMatchObject({ key: "k1", compaction: { summary: "Checkpoint", tokensAfter: 30_000 } });
  });
});

describe("buildTranscript, thinking", () => {
  /** The turn stamps the total on pi's own message object; the transcript reads it back. */
  const timed = (content: Extract<AgentMessage, { role: "assistant" }>["content"], thinkingMs: number): AgentMessage =>
    Object.assign(assistant(content), { thinkingMs });

  it("puts the message's duration on its thinking part", () => {
    const items = buildTranscript([
      timed([{ type: "thinking", thinking: "weighing the filings" }, { type: "text", text: "18.2%" }], 12_345),
    ]);
    expect(items[0].role === "assistant" && items[0].parts[0]).toMatchObject({ kind: "thinking", durationMs: 12_345 });
    expect(thoughtLabel(12_345)).toBe("Thought for 12s");
  });

  it("gives the total to the first block when the model reasoned more than once", () => {
    const items = buildTranscript([
      timed(
        [
          { type: "thinking", thinking: "first" },
          { type: "toolCall", id: "t1", name: "quote", arguments: {} },
          { type: "thinking", thinking: "second" },
        ],
        4_000,
      ),
    ]);
    const parts = items[0].role === "assistant" ? items[0].parts : [];
    expect(parts[0]).toMatchObject({ kind: "thinking", durationMs: 4_000 });
    expect(parts[2]).toMatchObject({ kind: "thinking" });
    expect(parts[2].kind === "thinking" && parts[2].durationMs).toBeUndefined();
  });

  it("leaves a chat saved before the turn timed it without a duration", () => {
    const items = buildTranscript([assistant([{ type: "thinking", thinking: "old" }])]);
    const part = items[0].role === "assistant" ? items[0].parts[0] : null;
    expect(part?.kind === "thinking" && part.durationMs).toBeUndefined();
  });
});

describe("thoughtLabel", () => {
  it("says how long the model thought", () => {
    expect(thoughtLabel(400)).toBe("Thought for a moment");
    expect(thoughtLabel(12_345)).toBe("Thought for 12s");
    expect(thoughtLabel(59_400)).toBe("Thought for 59s");
    expect(thoughtLabel(65_000)).toBe("Thought for 1m 5s");
    expect(thoughtLabel(3_600_000)).toBe("Thought for 60m 0s");
  });

  it("says that it is still thinking only while the block is growing", () => {
    expect(thoughtLabel(undefined, true)).toBe("Thinking…");
    expect(thoughtLabel(undefined)).toBe("Thoughts");
    expect(thoughtLabel(12_345, true)).toBe("Thought for 12s");
  });
});

describe("endThinking", () => {
  it("times the live thinking block the moment reasoning stops", () => {
    const parts: MessagePart[] = [{ kind: "thinking", text: "weighing" }];
    expect(endThinking(parts, 2_000)).toEqual([{ kind: "thinking", text: "weighing", durationMs: 2_000 }]);
  });

  it("leaves a block that is already timed, and a turn with no reasoning, alone", () => {
    const timed: MessagePart[] = [{ kind: "thinking", text: "weighing", durationMs: 1 }];
    expect(endThinking(timed, 2_000)).toBe(timed);
    const text: MessagePart[] = [{ kind: "text", text: "hi" }];
    expect(endThinking(text, 2_000)).toBe(text);
  });
});

