import { describe, expect, it } from "vitest";
import {
  cikFromFilingUrl,
  dateFromDocumentUrl,
  decodeEntities,
  filingDateFromIndex,
  htmlToText,
  isFilingIndexUrl,
  parseFilingIndex,
} from "./filing";

describe("decodeEntities", () => {
  it("decodes named, decimal and hex references", () => {
    // The decoder does not collapse whitespace; htmlToText does that afterwards.
    expect(decodeEntities("R&amp;D &#8212; up 12&#x25;&nbsp;YoY")).toBe("R&D — up 12% YoY");
  });

  it("leaves unknown references alone", () => {
    expect(decodeEntities("&notanentity; &amp;")).toBe("&notanentity; &");
  });
});

describe("htmlToText", () => {
  it("drops scripts and styles entirely", () => {
    const html = "<div>Kept<script>var a = 1 < 2;</script><style>p{color:red}</style></div>";
    expect(htmlToText(html)).toBe("Kept");
  });

  it("turns block tags into line breaks", () => {
    expect(htmlToText("<p>First</p><p>Second</p>").split("\n")).toEqual(["First", "Second"]);
  });

  it("keeps table rows readable as pipe-separated cells", () => {
    const html = "<table><tr><td>Revenue</td><td>$46,743</td></tr><tr><td>EPS</td><td>1.05</td></tr></table>";
    expect(htmlToText(html).split("\n")).toEqual(["Revenue | $46,743", "EPS | 1.05"]);
  });

  it("collapses runs of whitespace and blank lines", () => {
    expect(htmlToText("<p>  a   b  </p>\n\n\n<p>c</p>")).toBe("a b\nc");
  });
});

describe("isFilingIndexUrl", () => {
  const base = "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000073";

  it("recognises index pages and bare directories", () => {
    expect(isFilingIndexUrl(`${base}/0001045810-26-000073-index.htm`)).toBe(true);
    expect(isFilingIndexUrl(`${base}/`)).toBe(true);
  });

  it("treats a document as a document", () => {
    expect(isFilingIndexUrl(`${base}/q2fy27pr.htm`)).toBe(false);
    expect(isFilingIndexUrl(`${base}/0001045810-26-000073.txt`)).toBe(false);
  });
});

const indexHtml = `
<table class="tableFile" summary="Document Format Files">
  <tr><th>Seq</th><th>Description</th><th>Document</th><th>Type</th><th>Size</th></tr>
  <tr><td>1</td><td>8-K</td>
      <td><a href="/ix?doc=/Archives/edgar/data/1045810/000104581026000073/nvda-20260826.htm">nvda-20260826.htm</a></td>
      <td>8-K</td><td>26457</td></tr>
  <tr><td>2</td><td>EX-99.1</td>
      <td><a href="/Archives/edgar/data/1045810/000104581026000073/q2fy27pr.htm">q2fy27pr.htm</a></td>
      <td>EX-99.1</td><td>341113</td></tr>
</table>`;

describe("parseFilingIndex", () => {
  const documents = parseFilingIndex(indexHtml);

  it("lists every document with an absolute URL", () => {
    expect(documents).toHaveLength(2);
    expect(documents[1]).toMatchObject({
      seq: "2",
      type: "EX-99.1",
      file: "q2fy27pr.htm",
      url: "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000073/q2fy27pr.htm",
    });
  });

  it("unwraps the inline-XBRL viewer link", () => {
    expect(documents[0].url).toBe(
      "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000073/nvda-20260826.htm",
    );
  });
});

describe("cikFromFilingUrl", () => {
  it("reads the filer out of an archive path", () => {
    expect(
      cikFromFilingUrl("https://www.sec.gov/Archives/edgar/data/1045810/000104581026000073/q2fy27pr.htm"),
    ).toBe("0001045810");
  });

  it("has nothing to say about other sec.gov URLs", () => {
    expect(cikFromFilingUrl("https://www.sec.gov/files/company_tickers.json")).toBeUndefined();
  });
});

describe("filingDateFromIndex", () => {
  it("takes the date the index page states", () => {
    const html = '<div class="formGrouping"><div class="infoHead">Filing Date</div><div class="info">2026-08-26</div></div>';
    expect(filingDateFromIndex(html)).toBe("2026-08-26");
  });

  it("invents nothing when the page does not say", () => {
    expect(filingDateFromIndex("<div>Accepted 2026-08-26</div>")).toBeUndefined();
  });
});

describe("dateFromDocumentUrl", () => {
  it("reads the period out of the document file name", () => {
    expect(
      dateFromDocumentUrl("https://www.sec.gov/Archives/edgar/data/1045810/000104581026000073/nvda-20260826.htm"),
    ).toBe("2026-08-26");
  });

  it("never mistakes an accession number or a CIK for a date", () => {
    const base = "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000073";
    expect(dateFromDocumentUrl(`${base}/0001045810-26-000073.txt`)).toBeUndefined();
    expect(dateFromDocumentUrl(`${base}/q2fy27pr.htm`)).toBeUndefined();
    // 2026-13-01 is not a date.
    expect(dateFromDocumentUrl(`${base}/nvda-20261301.htm`)).toBeUndefined();
  });
});
