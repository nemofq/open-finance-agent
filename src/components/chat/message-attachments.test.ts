import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import type { StoredAttachment, StoredImage } from "@/lib/attachments/types";
import { carryAttachments, documentNote, documentsOfMessage, documentState, imagesOfMessage } from "./message-attachments";

const descriptor = (name: string, extra: Partial<StoredAttachment> = {}): StoredAttachment => ({
  attachment: `${"a".repeat(40)}.${name.split(".").at(-1)}`,
  name,
  kind: "document",
  bytes: 4096,
  tokens: 1200,
  parts: 1,
  ...extra,
});

const stored = (attachment: string, extra: Partial<StoredImage> = {}): StoredImage => ({
  type: "image",
  data: "",
  mimeType: "image/png",
  attachment,
  bytes: 1024,
  ...extra,
});

describe("documentState", () => {
  it("counts a PDF in pages", () => {
    expect(documentState(descriptor("10-K.pdf", { kind: "pdf", parts: 62, tokens: 84_000 }))).toBe(
      "62 pages · ~84k tokens",
    );
  });

  it("counts a workbook in sheets and rows", () => {
    expect(documentState(descriptor("model.xlsx", { kind: "table", parts: 3, rows: 4_210 }))).toBe(
      "3 sheets · 4,210 rows",
    );
  });

  it("falls back to the token estimate for a table that reported no rows", () => {
    expect(documentState(descriptor("model.xlsx", { kind: "table", parts: 3, tokens: 8_240 }))).toBe(
      "3 sheets · ~8.2k tokens",
    );
  });

  it("counts a deck in slides, and says one of them in the singular", () => {
    expect(documentState(descriptor("deck.pptx", { parts: 1, tokens: 420 }))).toBe("1 slide · ~420 tokens");
  });

  it("says only the size for a format whose parts have no name", () => {
    expect(documentState(descriptor("Q3 memo.docx", { parts: 1, tokens: 12_500 }))).toBe("~12.5k tokens");
  });
});

describe("documentNote", () => {
  it("says a truncated file will be read in parts", () => {
    expect(documentNote(descriptor("10-K.pdf", { truncated: true }))).toBe(
      "Large file: the agent will read it in parts",
    );
  });

  it("says the same for a file larger than the turn's inline budget", () => {
    expect(documentNote(descriptor("10-K.pdf", { tokens: 40_000 }), 25_600)).toBe(
      "Large file: the agent will read it in parts",
    );
  });

  it("stays quiet for a file that fits", () => {
    expect(documentNote(descriptor("Q3 memo.docx", { tokens: 3_000 }), 25_600)).toBeUndefined();
    expect(documentNote(descriptor("Q3 memo.docx", { tokens: 3_000 }))).toBeUndefined();
  });

  it("leaves a table alone, however large: its rows never ride in the context", () => {
    expect(documentNote(descriptor("model.xlsx", { kind: "table", tokens: 400_000 }), 25_600)).toBeUndefined();
  });
});

describe("imagesOfMessage", () => {
  it("builds attachment URLs for a saved user turn", () => {
    const message: AgentMessage = {
      role: "user",
      content: [{ type: "text", text: "what is this" }, stored("abc.png", { width: 800, height: 600 })],
      timestamp: 0,
    };
    expect(imagesOfMessage(message, "s1", "u0")).toEqual([
      {
        key: "u0:0",
        url: "/api/sessions/s1/attachments/abc.png",
        alt: "Attached image",
        width: 800,
        height: 600,
      },
    ]);
  });

  it("numbers the thumbnails when a turn carries several", () => {
    const message: AgentMessage = {
      role: "user",
      content: [stored("one.png"), stored("two.png")],
      timestamp: 0,
    };
    expect(imagesOfMessage(message, "s1", "u0").map((image) => image.alt)).toEqual([
      "Attached image 1 of 2",
      "Attached image 2 of 2",
    ]);
  });

  it("shows the optimistic preview before the server has saved anything", () => {
    const message: AgentMessage = {
      role: "user",
      content: [{ ...stored(""), previewUrl: "blob:local-1" } as StoredImage],
      timestamp: 0,
    };
    expect(imagesOfMessage(message, null, "u0")).toEqual([
      { key: "u0:0", previewUrl: "blob:local-1", alt: "Attached image" },
    ]);
  });

  it("skips a stored image while the chat has no id to fetch it from", () => {
    const message: AgentMessage = { role: "user", content: [stored("abc.png")], timestamp: 0 };
    expect(imagesOfMessage(message, null, "u0")).toEqual([]);
  });

  it("reads a skill turn's images", () => {
    const message: AgentMessage = {
      role: "skill",
      skill: "earnings-review",
      request: "$AAPL",
      prompt: "<skill>…</skill>",
      images: [stored("abc.png")],
      timestamp: 0,
    };
    expect(imagesOfMessage(message, "s1", "u0")).toMatchObject([
      { key: "u0:0", url: "/api/sessions/s1/attachments/abc.png" },
    ]);
  });

  it("finds nothing on a plain text turn", () => {
    expect(imagesOfMessage({ role: "user", content: "hello", timestamp: 0 }, "s1", "u0")).toEqual([]);
  });

  it("offers both URLs once the echo has brought the preview across", () => {
    const message: AgentMessage = {
      role: "user",
      content: [{ ...stored("abc.png"), previewUrl: "blob:local-1" } as StoredImage],
      timestamp: 0,
    };
    expect(imagesOfMessage(message, "s1", "u0")).toEqual([
      {
        key: "u0:0",
        url: "/api/sessions/s1/attachments/abc.png",
        previewUrl: "blob:local-1",
        alt: "Attached image",
      },
    ]);
  });

  it("keys a thumbnail the same before and after the swap", () => {
    const optimistic: AgentMessage = {
      role: "user",
      content: [{ ...stored(""), previewUrl: "blob:local-1" } as StoredImage],
      timestamp: 0,
    };
    const saved: AgentMessage = { role: "user", content: [stored("abc.png")], timestamp: 0 };
    expect(imagesOfMessage(optimistic, "s1", "u0")[0].key).toBe(imagesOfMessage(saved, "s1", "u0")[0].key);
  });
});

describe("documentsOfMessage", () => {
  const memo = descriptor("Q3 memo.docx", { parts: 12, tokens: 8_000 });

  it("points a saved turn's chips at the download and the parse", () => {
    const message: AgentMessage = { role: "user", content: "read this", documents: [memo], timestamp: 0 };
    expect(documentsOfMessage(message, "s1", "u0")).toEqual([
      {
        key: "u0:d0",
        document: memo,
        url: `/api/sessions/s1/attachments/${memo.attachment}`,
        textUrl: `/api/sessions/s1/attachments/${memo.attachment}/text`,
      },
    ]);
  });

  it("still shows the chip before the chat has an id, with nothing to open", () => {
    const message: AgentMessage = { role: "user", content: "read this", documents: [memo], timestamp: 0 };
    expect(documentsOfMessage(message, null, "u0")).toEqual([{ key: "u0:d0", document: memo }]);
  });

  it("reads a skill turn's documents", () => {
    const message: AgentMessage = {
      role: "skill",
      skill: "earnings-review",
      request: "$AAPL",
      prompt: "<skill>…</skill>",
      documents: [memo],
      timestamp: 0,
    };
    expect(documentsOfMessage(message, "s1", "u0")).toMatchObject([{ key: "u0:d0", document: memo }]);
  });

  it("finds nothing on a turn that carried none", () => {
    expect(documentsOfMessage({ role: "user", content: "hello", timestamp: 0 }, "s1", "u0")).toEqual([]);
  });
});

describe("carryAttachments", () => {
  it("takes the saved turn's own documents, which the server has already claimed", () => {
    const memo = descriptor("Q3 memo.docx");
    const optimistic: AgentMessage = { role: "user", content: "read this", documents: [memo], timestamp: 0 };
    const saved: AgentMessage = { role: "user", content: "read this", documents: [memo], timestamp: 0 };
    expect(carryAttachments(optimistic, saved)).toBe(saved);
  });

  const optimistic = (...previewUrls: string[]): AgentMessage => ({
    role: "user",
    content: [
      { type: "text", text: "look" },
      ...previewUrls.map((previewUrl) => ({ ...stored(""), previewUrl }) as StoredImage),
    ],
    timestamp: 0,
  });

  it("pairs the object URLs with the saved blocks by position", () => {
    const saved: AgentMessage = {
      role: "user",
      content: [{ type: "text", text: "look" }, stored("one.png"), stored("two.png")],
      timestamp: 0,
    };
    const merged = imagesOfMessage(carryAttachments(optimistic("blob:a", "blob:b"), saved), "s1", "u0");
    expect(merged.map((image) => [image.url, image.previewUrl])).toEqual([
      ["/api/sessions/s1/attachments/one.png", "blob:a"],
      ["/api/sessions/s1/attachments/two.png", "blob:b"],
    ]);
  });

  it("carries them onto a skill turn's images too", () => {
    const saved: AgentMessage = {
      role: "skill",
      skill: "earnings-review",
      request: "$AAPL",
      prompt: "<skill>…</skill>",
      images: [stored("one.png")],
      timestamp: 0,
    };
    expect(imagesOfMessage(carryAttachments(optimistic("blob:a"), saved), "s1", "u0")).toMatchObject([
      { previewUrl: "blob:a" },
    ]);
  });

  it("leaves a turn that had no images exactly as the server sent it", () => {
    const saved: AgentMessage = { role: "user", content: "hi", timestamp: 0 };
    expect(carryAttachments({ role: "user", content: "hi", timestamp: 0 }, saved)).toBe(saved);
  });

  it("leaves the saved turn alone when there is nothing before it", () => {
    const saved: AgentMessage = { role: "user", content: [stored("one.png")], timestamp: 0 };
    expect(carryAttachments(undefined, saved)).toBe(saved);
  });
});
