import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { MAX_TEXT_CHARS, MAX_ZIP_DECOMPRESSED_BYTES, MAX_ZIP_ENTRIES } from "../limits";
import { buildPptx, declareUncompressedSize } from "./fixtures/pptx-decks";
import { parse } from "./pptx";

const deck = async (...slides: Parameters<typeof buildPptx>[0]["slides"]) =>
  parse(await buildPptx({ slides }), "deck.pptx");

describe("parsing a pptx", () => {
  it("follows the presentation's slide list, not the slide file names", async () => {
    const bytes = await buildPptx({
      reverseFileNames: true,
      slides: [{ title: "Opening" }, { title: "Numbers" }, { title: "Closing" }],
    });
    const parsed = await parse(bytes, "deck.pptx");

    expect(parsed.kind).toBe("document");
    expect(parsed.parts.map((part) => part.label)).toEqual(["Slide 1", "Slide 2", "Slide 3"]);
    // The label says which slide it is; repeating it in the markdown would say it twice.
    expect(parsed.parts.map((part) => (part.type === "text" ? part.markdown : ""))).toEqual([
      "## Opening",
      "## Numbers",
      "## Closing",
    ]);
  });

  it("renders the title, the bullets at their level, the table and the notes", async () => {
    const parsed = await deck({
      bullets: [{ text: "Revenue up 12%" }, { level: 1, text: "Europe led the quarter" }],
      notes: "Mention the buyback.",
      table: [
        ["Region", "Q3"],
        ["Europe", "12.4"],
      ],
      title: "Q3 results",
    });

    expect(parsed.parts[0]).toEqual({
      label: "Slide 1",
      markdown: [
        "## Q3 results",
        "",
        "- Revenue up 12%",
        "  - Europe led the quarter",
        "",
        "| Region | Q3 |",
        "| --- | --- |",
        "| Europe | 12.4 |",
        "",
        "### Notes",
        "",
        "Mention the buyback.",
      ].join("\n"),
      type: "text",
    });
    expect(parsed.warnings).toEqual([]);
  });

  it("gives the outline one entry per slide", async () => {
    const parsed = await deck({ title: "Opening" }, { bullets: [{ text: "no title here" }] });

    expect(parsed.outline).toEqual([
      { level: 1, part: 0, title: "Opening" },
      { level: 1, part: 1, title: "Slide 2" },
    ]);
    // A slide with no title opens on its bullets rather than on an empty heading.
    expect(parsed.parts[1]?.type === "text" && parsed.parts[1].markdown).toBe("- no title here");
  });

  it("leaves an entity declared in the file unexpanded, and decodes the predefined ones", async () => {
    const parsed = await parse(
      await buildPptx({
        doctype: '<!DOCTYPE p:sld [ <!ENTITY xxe "SECRET"> ]>',
        slides: [{ extraShapes: "<p:sp><p:txBody><a:p><a:r><a:t>&xxe; fees &amp; taxes</a:t></a:r></a:p></p:txBody></p:sp>" }],
      }),
      "deck.pptx",
    );

    const markdown = parsed.parts[0]?.type === "text" ? parsed.parts[0].markdown : "";
    expect(markdown).toContain("- &xxe; fees & taxes");
    expect(markdown).not.toContain("SECRET");
  });

  it("refuses a zip with more entries than the cap", async () => {
    const bytes = await buildPptx({ filler: MAX_ZIP_ENTRIES + 1, slides: [{ title: "Opening" }] });

    await expect(parse(bytes, "deck.pptx")).rejects.toThrow(/deck\.pptx holds [\d,]+ zip entries/);
  });

  it("refuses a zip that declares more decompressed bytes than the cap", async () => {
    const bytes = declareUncompressedSize(
      await buildPptx({ slides: [{ title: "Opening" }] }),
      MAX_ZIP_DECOMPRESSED_BYTES,
    );

    await expect(parse(bytes, "deck.pptx")).rejects.toThrow(/unpacks to more than [\d,]+ MB/);
  });

  it("truncates at the text cap instead of failing", async () => {
    const parsed = await deck({ bullets: [{ text: "x".repeat(MAX_TEXT_CHARS + 100) }] }, { title: "Closing" });

    expect(parsed.parts).toHaveLength(1);
    expect(parsed.parts[0]?.type === "text" && parsed.parts[0].markdown).toHaveLength(MAX_TEXT_CHARS);
    expect(parsed.truncated).toBe(true);
    expect(parsed.warnings).toEqual([expect.stringMatching(/^Stopped at slide 1 of 2/)]);
  });

  it("warns rather than throws when the package holds no slides", async () => {
    const parsed = await parse(await buildPptx({ slides: [] }), "deck.pptx");

    expect(parsed.parts).toEqual([]);
    expect(parsed.warnings).toEqual(["deck.pptx has no slides."]);
  });

  it("explains a file that is not a pptx", async () => {
    const ole2 = new Uint8Array(64);
    ole2.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    const zip = new JSZip();
    zip.file("word/document.xml", "<w:document/>");

    await expect(parse(new Uint8Array([1, 2, 3, 4]), "deck.pptx")).rejects.toThrow(
      "deck.pptx is not a readable .pptx file.",
    );
    // A zip that holds no presentation: some other format wearing the extension.
    await expect(parse(await zip.generateAsync({ type: "uint8array" }), "deck.pptx")).rejects.toThrow(
      "deck.pptx is not a readable .pptx file.",
    );
    // An encrypted pptx; `sniff` names it password-protected before it gets here.
    await expect(parse(ole2, "deck.pptx")).rejects.toThrow("deck.pptx is not a readable .pptx file.");
  });
});
