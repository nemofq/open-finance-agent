import { describe, expect, it } from "vitest";
import { MAX_TEXT_CHARS } from "../limits";
import { htmlToMarkdown, parse } from "./html";

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

const page = `<!doctype html><html><head><title>Ignored</title><style>p{color:red}</style></head><body>
  <nav>Home | About</nav>
  <h1>Quarterly memo</h1>
  <p>Revenue rose <strong>12%</strong>.</p>
  <h2>Segments</h2>
  <ul><li>Cloud</li><li>Devices</li></ul>
  <table><thead><tr><th>Segment</th><th>Revenue</th></tr></thead><tbody><tr><td>Cloud</td><td>$46,743</td></tr></tbody></table>
  <script>var a = 1 < 2;</script><noscript>Enable JavaScript</noscript><iframe src="/ad"></iframe>
</body></html>`;

describe("htmlToMarkdown", () => {
  it("keeps headings, emphasis, lists and tables", async () => {
    expect(await htmlToMarkdown(page)).toBe(
      [
        "# Quarterly memo",
        "",
        "Revenue rose **12%**.",
        "",
        "## Segments",
        "",
        "- Cloud",
        "- Devices",
        "",
        "| Segment | Revenue |",
        "| ------- | ------- |",
        "| Cloud   | $46,743 |",
      ].join("\n"),
    );
  });

  it("drops chrome, script, style and frames", async () => {
    const markdown = await htmlToMarkdown(page);
    for (const dropped of ["Ignored", "color:red", "Home | About", "var a", "Enable JavaScript"]) {
      expect(markdown).not.toContain(dropped);
    }
  });

  it("promotes the first row of a header-less table, which is what Word emits", async () => {
    const html = "<table><tr><td>Segment</td><td>Revenue</td></tr><tr><td>Cloud</td><td>46743</td></tr></table>";
    expect(await htmlToMarkdown(html)).toBe(
      ["| Segment | Revenue |", "| ------- | ------- |", "| Cloud   | 46743   |"].join("\n"),
    );
  });

  it("leaves a table that declares its own header alone", async () => {
    const html = "<table><tr><th>Segment</th></tr><tr><td>Cloud</td></tr><tr><td>Devices</td></tr></table>";
    expect(await htmlToMarkdown(html)).toContain("| Cloud   |\n| Devices |");
  });
});

describe("parse", () => {
  it("returns one document part with the outline of its headings", async () => {
    const parsed = await parse(utf8(page), "memo.html");
    expect(parsed.kind).toBe("document");
    expect(parsed.parts).toHaveLength(1);
    expect(parsed.parts[0]).toMatchObject({ type: "text", label: "Document" });
    expect(parsed.outline).toEqual([
      { part: 0, level: 1, title: "Quarterly memo" },
      { part: 0, level: 2, title: "Segments" },
    ]);
    expect(parsed.warnings).toEqual([]);
  });

  it("reads a file that is not really HTML as the text it is", async () => {
    const parsed = await parse(utf8("just some notes, saved with the wrong extension"), "notes.html");
    expect(parsed.parts[0]).toMatchObject({ markdown: "just some notes, saved with the wrong extension" });
    expect(parsed.warnings).toEqual([]);
  });

  it("never throws on malformed markup", async () => {
    const parsed = await parse(utf8("<p>unclosed <b>bold <table><tr><td>cell"), "broken.html");
    expect(parsed.parts[0]).toMatchObject({ markdown: expect.stringContaining("cell") });
  });

  it("falls back to Latin-1 for bytes that are not UTF-8", async () => {
    const parsed = await parse(Uint8Array.from([...utf8("<p>caf"), 0xe9, ...utf8("</p>")]), "page.html");
    expect(parsed.parts[0]).toMatchObject({ markdown: "café" });
    expect(parsed.warnings).toEqual([expect.stringContaining("Latin-1")]);
  });

  it("truncates an oversized page rather than throwing", async () => {
    const parsed = await parse(utf8(`<p>${"x".repeat(MAX_TEXT_CHARS + 10)}</p>`), "huge.html");
    expect((parsed.parts[0] as { markdown: string }).markdown).toHaveLength(MAX_TEXT_CHARS);
    expect(parsed.truncated).toBe(true);
  });

  it("names a file with no readable content in a warning", async () => {
    const parsed = await parse(utf8("<html><head><title>t</title></head><body></body></html>"), "empty.html");
    expect(parsed.parts[0]).toMatchObject({ markdown: "" });
    expect(parsed.warnings).toEqual(["empty.html has no text."]);
  });
});
