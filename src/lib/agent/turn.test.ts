import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, AssistantMessageEvent } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import type { StoredAttachment, StoredImage } from "@/lib/attachments/types";
import { assistant } from "@/lib/context/testing";
import { applySkillInvocation } from "@/lib/skills/loader";
import type { Skill } from "@/lib/skills/skill";
import { stampThinking, type ThinkingSpan, turnPrompt } from "./turn";

const reasoning = (): AssistantMessage => assistant({ thinking: "weighing the filings" });

const thought = (message: AssistantMessage): AgentEvent => ({
  type: "message_update",
  message,
  assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "…", partial: message } as AssistantMessageEvent,
});

const wrote = (message: AssistantMessage): AgentEvent => ({
  type: "message_update",
  message,
  assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "hi", partial: message } as AssistantMessageEvent,
});

/** Drive the handler's own sequence, one event at a time, on a clock the test controls. */
function run(events: [AgentEvent, number][]): ThinkingSpan {
  let span: ThinkingSpan = {};
  for (const [event, now] of events) span = stampThinking(span, event, now);
  return span;
}

describe("stampThinking", () => {
  it("stamps the span between the first and last thinking delta", () => {
    const message = reasoning();
    run([
      [{ type: "message_start", message }, 1000],
      [thought(message), 1200],
      [thought(message), 4500],
      [wrote(message), 5000],
      [{ type: "message_end", message }, 6000],
    ]);
    expect(message.thinkingMs).toBe(3300);
  });

  it("leaves a message that never reasoned unstamped", () => {
    const message = reasoning();
    run([
      [{ type: "message_start", message }, 1000],
      [wrote(message), 1100],
      [{ type: "message_end", message }, 1200],
    ]);
    expect(message.thinkingMs).toBeUndefined();
  });

  it("times each message on its own, not the whole turn", () => {
    const first = reasoning();
    const second = reasoning();
    run([
      [thought(first), 1000],
      [thought(first), 1400],
      [{ type: "message_end", message: first }, 1500],
      [thought(second), 9000],
      [thought(second), 9100],
      [{ type: "message_end", message: second }, 9200],
    ]);
    expect(first.thinkingMs).toBe(400);
    expect(second.thinkingMs).toBe(100);
  });

  it("clears the span at a message boundary", () => {
    const message = reasoning();
    expect(run([[thought(message), 500], [{ type: "message_start", message }, 600]])).toEqual({});
    expect(run([[thought(message), 500], [{ type: "message_end", message }, 600]])).toEqual({});
  });

  it("ignores messages that are not the assistant's", () => {
    const message = reasoning();
    const user = { role: "user", content: "hello", timestamp: 0 } as const;
    run([
      [thought(message), 1000],
      [{ type: "message_end", message: user }, 1500],
    ]);
    expect((user as { thinkingMs?: number }).thinkingMs).toBeUndefined();
  });
});

/** An image as the transcript holds it: the payload is on disk, so `data` is empty here. */
const image = (attachment: string): StoredImage => ({ type: "image", data: "", mimeType: "image/png", attachment, bytes: 512 });

const shot = image(`${"a".repeat(40)}.png`);
const chart = image(`${"b".repeat(40)}.png`);

/** A document as the transcript holds it: a descriptor, with the text on disk. */
const memo: StoredAttachment = {
  attachment: `${"c".repeat(40)}.docx`,
  name: "Q3 memo.docx",
  kind: "document",
  bytes: 4_096,
  tokens: 8_000,
  parts: 12,
};

describe("turnPrompt", () => {
  it("keeps a message with nothing attached as the plain string pi has always been given", () => {
    expect(turnPrompt({ text: "how did $NVDA do?", timestamp: 7 })).toBe("how did $NVDA do?");
    expect(turnPrompt({ text: "how did $NVDA do?", images: [], documents: [], timestamp: 7 })).toBe("how did $NVDA do?");
  });

  it("puts the question first and the pictures after it", () => {
    expect(turnPrompt({ text: "what is this?", images: [shot, chart], timestamp: 7 })).toEqual({
      role: "user",
      content: [{ type: "text", text: "what is this?" }, shot, chart],
      timestamp: 7,
    });
  });

  it("sends the images alone when the user typed nothing", () => {
    expect(turnPrompt({ text: "", images: [shot], timestamp: 7 })).toEqual({ role: "user", content: [shot], timestamp: 7 });
  });

  it("carries documents beside the content, where pi has no block for them", () => {
    expect(turnPrompt({ text: "read this", documents: [memo], timestamp: 7 })).toEqual({
      role: "user",
      content: [{ type: "text", text: "read this" }],
      documents: [memo],
      timestamp: 7,
    });
  });

  const skill: Skill = { name: "earnings-preview", description: "Preview.", body: "# Preview", source: "bundled", filePath: "/skills/earnings-preview/SKILL.md" };

  it("keeps a skill turn's typed request apart from the expanded prompt, attachments beside it", () => {
    expect(turnPrompt({ text: "$NVDA", skill, documents: [memo], timestamp: 7 })).toEqual({
      role: "skill", skill: "earnings-preview", request: "$NVDA", prompt: applySkillInvocation("$NVDA", skill), timestamp: 7, documents: [memo],
    });
  });

  it("runs a scheduled task as its own message, with the skill it names", () => {
    const scheduled = { taskId: "t1", runId: "r1" };
    expect(turnPrompt({ text: "weekly check", scheduled, timestamp: 7 })).toEqual({
      role: "scheduled", taskId: "t1", runId: "r1", request: "weekly check", prompt: "weekly check", timestamp: 7,
    });
    expect(turnPrompt({ text: "weekly check", skill, scheduled, timestamp: 7 })).toMatchObject({ skill: "earnings-preview", prompt: applySkillInvocation("weekly check", skill) });
  });
});
