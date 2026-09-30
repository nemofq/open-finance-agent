import { describe, expect, it } from "vitest";
import { blockText } from "./blocks";

describe("blockText", () => {
  const content = [
    { type: "text", text: "first" },
    { type: "image", data: "", mimeType: "image/png" },
    { type: "thinking", thinking: "hidden" },
    { type: "text", text: "second" },
  ];

  it("joins the text blocks with the separator given and leaves every other kind out", () => {
    expect(blockText(content, "\n")).toBe("first\nsecond");
    expect(blockText(content, "")).toBe("firstsecond");
  });

  it("keeps an empty text block, so the separators stay where they were", () => {
    const blocks = [{ type: "text", text: "a" }, { type: "text", text: "" }, { type: "text", text: "b" }];
    expect(blockText(blocks, "\n")).toBe("a\n\nb");
  });
});
