import ExcelJS from "exceljs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { MAX_TABLE_BYTES, MAX_TABLE_COLUMNS, MAX_TABLE_ROWS, MAX_ZIP_ENTRIES } from "../limits";
import type { AttachmentTablePart, ParsedAttachment } from "../types";
import { parse } from "./tabular";

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function table(parsed: ParsedAttachment, index = 0): AttachmentTablePart {
  const part = parsed.parts[index];
  if (part?.type !== "table") throw new Error(`Part ${index} is not a table.`);
  return part;
}

async function workbookBytes(build: (workbook: ExcelJS.Workbook) => void): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  build(workbook);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

describe("tabular attachments: csv", () => {
  it("types numbers, blanks and text, and keeps quoted delimiters", async () => {
    const parsed = await parse(
      bytes('Symbol,Price,Weight,Note\nAAPL,"$1,234.50",12%,"Big, safe"\nMSFT,(12),,—\n'),
      "holdings.csv",
    );
    expect(parsed).toMatchObject({ version: 1, kind: "table", warnings: [] });
    expect(parsed.outline).toEqual([{ part: 0, level: 1, title: "Sheet" }]);
    const part = table(parsed);
    expect(part.label).toBe("Sheet");
    expect(part.columns).toEqual(["Symbol", "Price", "Weight", "Note"]);
    expect(part.rows).toEqual([
      ["AAPL", 1234.5, 12, "Big, safe"],
      ["MSFT", -12, null, "—"],
    ]);
    expect(part.totalRows).toBe(2);
  });

  it("keeps an identifier that only looks like a number", async () => {
    const part = table(await parse(bytes("Account,Zip\n00123,02134\n"), "accounts.csv"));
    expect(part.rows[0]).toEqual(["00123", "02134"]);
  });

  it.each([
    [";", "semicolons"],
    ["\t", "tabs"],
    ["|", "pipes"],
  ])("sniffs %s as the delimiter when a file uses %s", async (delimiter) => {
    const text = ["Symbol", "Name", "Shares"].join(delimiter) + "\n" + ["AAPL", "Apple, Inc.", "2"].join(delimiter);
    const part = table(await parse(bytes(text), "export.csv"));
    expect(part.columns).toEqual(["Symbol", "Name", "Shares"]);
    expect(part.rows).toEqual([["AAPL", "Apple, Inc.", 2]]);
  });

  it("falls back to latin-1 when the bytes are not UTF-8", async () => {
    const latin1 = Uint8Array.from("Symbol,Name\nBN,Société", (character) => character.charCodeAt(0));
    const parsed = await parse(latin1, "broker.csv");
    expect(table(parsed).rows[0]).toEqual(["BN", "Société"]);
    expect(parsed.warnings).toEqual([expect.stringContaining("Latin-1")]);
  });

  it("reads the UTF-16 text Excel saves as Unicode text", async () => {
    const text = "Symbol\tName\r\nBN\tSociété";
    const utf16 = new Uint8Array(2 + text.length * 2);
    utf16.set([0xff, 0xfe]);
    for (let index = 0; index < text.length; index += 1) utf16[2 + index * 2] = text.charCodeAt(index);
    const parsed = await parse(utf16, "broker.csv");
    expect(table(parsed).columns).toEqual(["Symbol", "Name"]);
    expect(table(parsed).rows[0]).toEqual(["BN", "Société"]);
    expect(parsed.warnings).toEqual([]);
  });

  it("names blank, repeated and missing headers", async () => {
    const part = table(await parse(bytes(",,Amount,Amount\n1,2,3,4,5\n"), "wide.csv"));
    expect(part.columns).toEqual(["Column 1", "Column 2", "Amount", "Column 4", "Column 5"]);
    expect(part.rows).toEqual([[1, 2, 3, 4, 5]]);
  });

  it("reports an empty file instead of failing", async () => {
    const parsed = await parse(new Uint8Array(0), "empty.csv");
    expect(parsed.parts).toEqual([]);
    expect(parsed.warnings).toEqual(["empty.csv has no rows."]);
  });

  it("keeps the first rows and the real row count past the row cap", async () => {
    const rows = Array.from({ length: MAX_TABLE_ROWS + 5 }, (_, index) => `A${index},1`);
    const parsed = await parse(bytes(`Symbol,Shares\n${rows.join("\n")}\n`), "long.csv");
    const part = table(parsed);
    expect(part.rows).toHaveLength(MAX_TABLE_ROWS);
    expect(part.totalRows).toBe(MAX_TABLE_ROWS + 5);
    expect(parsed.warnings).toEqual([expect.stringContaining("only the first 50,000 were kept")]);
  });

  it("keeps the first columns past the column cap", async () => {
    const header = Array.from({ length: MAX_TABLE_COLUMNS + 20 }, (_, index) => `C${index}`);
    const parsed = await parse(bytes(`${header.join(",")}\n${header.map(() => "1").join(",")}\n`), "wide.csv");
    const part = table(parsed);
    expect(part.columns).toHaveLength(MAX_TABLE_COLUMNS);
    expect(part.rows[0]).toHaveLength(MAX_TABLE_COLUMNS);
    expect(parsed.warnings).toEqual([expect.stringContaining(`only the first ${MAX_TABLE_COLUMNS}`)]);
  });

  it("stops adding rows before the serialised part passes the byte cap", async () => {
    const cell = "x".repeat(6_000);
    const rows = Array.from({ length: 1_000 }, () => `A,${cell}`);
    const parsed = await parse(bytes(`Symbol,Blob\n${rows.join("\n")}\n`), "fat.csv");
    const part = table(parsed);
    expect(part.totalRows).toBe(1_000);
    expect(part.rows.length).toBeLessThan(1_000);
    expect(Buffer.byteLength(JSON.stringify(part))).toBeLessThanOrEqual(MAX_TABLE_BYTES);
    expect(parsed.warnings).toEqual([expect.stringContaining("to stay under 5 MB")]);
  });
});

describe("tabular attachments: xlsx", () => {
  it("reads every worksheet, with dates, cached formula values and hidden sheets", async () => {
    const data = await workbookBytes((workbook) => {
      const holdings = workbook.addWorksheet("Holdings");
      holdings.addRow(["Trade Date", "Symbol", "Shares", "Value"]);
      holdings.addRow([new Date(Date.UTC(2024, 0, 31)), "AAPL", 12, null]);
      holdings.getCell("D2").value = { formula: "B2*C2", result: 2469.5 };
      const notes = workbook.addWorksheet("Notes");
      notes.state = "hidden";
      notes.addRow(["Note"]);
      notes.addRow(["Cash sweep"]);
    });

    const parsed = await parse(data, "book.xlsx");
    expect(parsed.parts.map((part) => part.label)).toEqual(["Holdings", "Notes (hidden)"]);
    expect(table(parsed).rows).toEqual([["2024-01-31", "AAPL", 12, 2469.5]]);
    expect(table(parsed, 1).rows).toEqual([["Cash sweep"]]);
    expect(parsed.warnings).toEqual([]);
  });

  it("skips an empty worksheet and says so", async () => {
    const data = await workbookBytes((workbook) => {
      const holdings = workbook.addWorksheet("Holdings");
      holdings.addRow(["Symbol"]);
      holdings.addRow(["AAPL"]);
      workbook.addWorksheet("Blank");
    });

    const parsed = await parse(data, "book.xlsx");
    expect(parsed.parts.map((part) => part.label)).toEqual(["Holdings"]);
    expect(parsed.warnings).toEqual(["Empty sheets were skipped: Blank."]);
  });

  it("refuses an archive with more entries than the zip cap allows", async () => {
    const zip = new JSZip();
    for (let index = 0; index <= MAX_ZIP_ENTRIES; index++) zip.file(`entry-${index}.xml`, "<x/>");
    const data = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
    await expect(parse(data, "bomb.xlsx")).rejects.toThrow(/zip entries; the limit is 2,000/);
  });

  it("reports a file that is not a workbook at all", async () => {
    const data = await new JSZip().file("hello.txt", "hi").generateAsync({ type: "uint8array" });
    await expect(parse(data, "notes.xlsx")).rejects.toThrow(/could not be read as a workbook/);
  });
});

describe("tabular attachments: markup", () => {
  it("refuses the html table an \"Excel\" export can turn out to be, naming the fix", async () => {
    const html = "<html><body><table><tr><th>Symbol</th></tr><tr><td>AAPL</td></tr></table></body></html>";
    await expect(parse(bytes(html), "positions.csv")).rejects.toThrow(
      "positions.csv is a web page or XML file, not a spreadsheet. Open it in Excel, save it as .xlsx or .csv and attach it again.",
    );
  });
});
