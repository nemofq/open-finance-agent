import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import type { StoredAttachment, StoredImage } from "@/lib/attachments/types";
import { estimateMessages, extraTokens, isCustomMessage, messageTokens, textTokens, tokenChars } from "./tokens";
import { assistant, user } from "./testing";

/** pi's estimate of a message's characters, at its 3.5 to a token; an image counts as 4,800. */
const piTokens = (chars: number) => Math.ceil(chars / 3.5);
const PI_IMAGE_CHARS = 4_800;

const image = (name: string): StoredImage => ({ type: "image", data: "", mimeType: "image/png", attachment: name, bytes: 4096 });

const skill = (prompt: string, images?: StoredImage[], documents?: StoredAttachment[]): AgentMessage => ({
  role: "skill",
  skill: "earnings-review",
  request: "",
  prompt,
  ...(images ? { images } : {}),
  ...(documents ? { documents } : {}),
  timestamp: 1,
});

const document = (tokens: number): StoredAttachment => ({
  attachment: `${"c".repeat(40)}.docx`,
  name: "Q3 memo.docx",
  kind: "document",
  bytes: tokens * 4,
  tokens,
  parts: 1,
});

const withDocuments = (text: string, documents: StoredAttachment[]): AgentMessage => ({
  role: "user",
  content: [{ type: "text", text }],
  documents,
  timestamp: 1,
});

describe("messageTokens", () => {
  it("counts the text a custom message sends to the model", () => {
    expect(messageTokens(skill("a".repeat(400)))).toBe(piTokens(400));
    expect(messageTokens({ role: "compaction", summary: "b".repeat(40), timestamp: 1 } as AgentMessage)).toBe(piTokens(40));
  });

  it("charges only what the model is sent: an open, enforced follow-up, and no flag or superseded draft", () => {
    const check = (kind: "flag" | "follow_up", resolved = false): AgentMessage => ({ role: "check", timestamp: 1,
      check: { id: "chk_1", rule: "P8", kind, reason: "r".repeat(400), text: "t".repeat(40), stage: "before_stop", mode: "enforce", enforced: true, timestamp: 1, resolved } });
    expect(messageTokens(check("follow_up"))).toBe(piTokens(40));
    expect(messageTokens(check("follow_up", true))).toBe(0);
    expect(messageTokens(check("flag"))).toBe(0);
    expect(messageTokens({ ...assistant({ text: "a".repeat(400) }), superseded: true })).toBe(0);
  });

  it("charges a skill turn for its images, which pi's estimator cannot see", () => {
    const prompt = "a".repeat(400);
    // pi prices an image at 4,800 characters and divides a message's characters once, text and images together.
    expect(messageTokens(skill(prompt, [image("x.png")]))).toBe(piTokens(400 + PI_IMAGE_CHARS));
    expect(messageTokens(skill(prompt, [image("x.png"), image("y.png")]))).toBe(piTokens(400 + 2 * PI_IMAGE_CHARS));
  });

  it("leaves a message the estimator already understands to pi", () => {
    expect(messageTokens(user("hello"))).toBe(estimateMessages([user("hello")]));
  });

  it("charges a message for the documents beside it, which pi has no block for", () => {
    const plain = messageTokens(withDocuments("read this", []));
    expect(messageTokens(withDocuments("read this", [document(2_000)]))).toBe(plain + 2_000);
    expect(messageTokens(skill("a".repeat(400), undefined, [document(2_000)]))).toBe(piTokens(400) + 2_000);
  });

  it("charges no more than could ever be inlined, so one huge file does not compact the chat", () => {
    const plain = messageTokens(withDocuments("read this", []));
    expect(messageTokens(withDocuments("read this", [document(500_000)]))).toBe(plain + 60_000);
  });

  it("counts the documents pi missed, and nothing else", () => {
    expect(extraTokens(withDocuments("read this", [document(2_000)]))).toBe(2_000);
    expect(extraTokens(assistant({ text: "x" }))).toBe(0);
  });
});

describe("token arithmetic", () => {
  it("rounds a text length up to whole tokens, and back down to whole characters", () => {
    // 3.5 characters to a token, pi's rate.
    expect(textTokens("abcde")).toBe(2);
    expect(textTokens("a".repeat(8))).toBe(3);
    expect(tokenChars(2)).toBe(7);
    expect(tokenChars(-1)).toBe(0);
  });

  it("knows which message kinds pi does not", () => {
    expect(isCustomMessage(skill("x"))).toBe(true);
    expect(isCustomMessage(assistant({ text: "x" }))).toBe(false);
  });
});
