import { describe, expect, it } from "vitest";
import type { StoredAttachment, StoredImage } from "@/lib/attachments/types";
import { cleanTitle, heuristicTitle, titleFromText, titlePrompt } from "./title";

describe("cleanTitle sentence case", () => {
  it("capitalises a lower-case first word and leaves a cashtag alone", () => {
    expect(cleanTitle("what is $MSFT quarterly revenue")).toBe("What is $MSFT quarterly revenue");
    expect(cleanTitle("$MSFT vs $GOOGL growth")).toBe("$MSFT vs $GOOGL growth");
  });
});

describe("cleanTitle", () => {
  it("keeps a plain title as written", () => {
    expect(cleanTitle("Microsoft quarterly revenue")).toBe("Microsoft quarterly revenue");
  });

  it("strips a label, quotes and a trailing period", () => {
    expect(cleanTitle('Title: "Nvidia margin outlook."')).toBe("Nvidia margin outlook");
    expect(cleanTitle("**Chat title** — Rate cut odds")).toBe("Rate cut odds");
  });

  it("unwraps a fenced reply and collapses its whitespace", () => {
    expect(cleanTitle("```\nBond   ladder\nfor 2027\n```")).toBe("Bond ladder for 2027");
  });

  it("keeps cashtags as written", () => {
    expect(cleanTitle("$MSFT and $BRK.B compared")).toBe("$MSFT and $BRK.B compared");
  });

  it("cuts a long title at a word boundary", () => {
    const long = "Comparing the quarterly operating margins of every large American railroad";
    const cut = cleanTitle(long);
    expect(cut).toBe("Comparing the quarterly operating margins of every large");
    expect(cut!.length).toBeLessThanOrEqual(60);
  });

  it("rejects a reply with nothing usable in it", () => {
    expect(cleanTitle("")).toBeNull();
    expect(cleanTitle("```\n```")).toBeNull();
    expect(cleanTitle(' "" ')).toBeNull();
  });
});

describe("titlePrompt", () => {
  it("sends the first message, the skill and the tickers", () => {
    const context = titlePrompt({ text: "How did $MSFT do?", skill: "earnings-review", tickers: ["MSFT"] });
    expect(context.messages).toHaveLength(1);
    const content = context.messages[0].content as string;
    expect(content).toContain("How did $MSFT do?");
    expect(content).toContain("Skill: earnings-review");
    expect(content).toContain("Tickers: $MSFT");
  });

  it("leaves out what the turn has not got", () => {
    const content = titlePrompt({ text: "Explain duration risk" }).messages[0].content as string;
    expect(content).toBe("Explain duration risk");
  });

  it("trims a very long first message", () => {
    const content = titlePrompt({ text: "$AAPL ".repeat(1_000) }).messages[0].content as string;
    expect(content.length).toBeLessThanOrEqual(1_500);
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

describe("heuristicTitle", () => {
  it("names a chat after what the user typed", () => {
    expect(heuristicTitle(undefined, "how did $NVDA do?", [shot])).toBe("how did $NVDA do?");
    expect(heuristicTitle("earnings-review", "", [])).toBe("/earnings-review");
  });

  it("names an image-only message after its images rather than leaving the default", () => {
    expect(heuristicTitle(undefined, "", [shot])).toBe("Image");
    expect(heuristicTitle(undefined, "", [shot, chart])).toBe("2 images");
  });

  it("names a file-only message after the file, which beats counting pictures", () => {
    expect(heuristicTitle(undefined, "", [], [memo])).toBe("Q3 memo.docx");
    expect(heuristicTitle(undefined, "", [shot], [memo, memo])).toBe("2 files");
  });

  it("leaves a message with nothing in it on the default title", () => {
    expect(heuristicTitle(undefined, "", [])).toBe("New chat");
  });
});

/** A store that remembers its patches, over a session the test can rewrite mid-flight. */

describe("titleFromText", () => {
  it("uses the first line", () => {
    expect(titleFromText("Earnings preview\nmore detail")).toBe("Earnings preview");
  });

  it("truncates long titles with an ellipsis", () => {
    expect(titleFromText("x".repeat(60))).toBe(`${"x".repeat(39)}…`);
  });

  it("falls back to the default for blank input", () => {
    expect(titleFromText("   ")).toBe("New chat");
  });
});
