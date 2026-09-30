import ExcelJS from "exceljs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { MAX_ZIP_DECOMPRESSED_BYTES, MAX_ZIP_ENTRIES } from "./limits";
import { declareUncompressedSize } from "./parse/fixtures/pptx-decks";
import {
  checkTableBytes,
  cleanCell,
  excelCellText,
  parseTableNumber,
  readCompleteDelimited,
  readCompleteWorkbook,
  readDelimited,
  readXlsxSheets,
  sniffDelimiter,
  TableTooLarge,
  tableCell,
} from "./tables";

describe("reading a cell", () => {
  it("reads spreadsheet numbers, accounting notation and blank markers", () => {
    expect(parseTableNumber("1,234.50")).toBe(1234.5);
    expect(parseTableNumber("(1,250)")).toBe(-1250);
    expect(parseTableNumber("$2,500.00")).toBe(2500);
    expect(parseTableNumber("12.5%")).toBe(12.5);
    expect(parseTableNumber("—")).toBeNull();
    expect(parseTableNumber("n/a")).toBeNull();
    expect(parseTableNumber("1.2.3")).toBeNull();
    expect(parseTableNumber("not-a-number")).toBeNull();
  });

  it("keeps a cell's type: numbers, padded identifiers, booleans, errors and blanks", () => {
    expect(tableCell(42)).toBe(42);
    expect(tableCell(Number.NaN)).toBeNull();
    expect(tableCell(" 1,000 ")).toBe(1000);
    expect(tableCell("007")).toBe("007");
    expect(tableCell(true)).toBe("TRUE");
    expect(tableCell({ error: "#DIV/0!" })).toBe("#DIV/0!");
    expect(tableCell({ formula: "A1*2", result: 84 })).toBe(84);
    expect(tableCell({ richText: [{ text: "Apple " }, { text: "Inc" }] })).toBe("Apple Inc");
    expect(tableCell(" ")).toBeNull();
    expect(tableCell(undefined)).toBeNull();
  });

  it("reads a date as the day it names in UTC, and keeps the instant when there is a clock reading", () => {
    expect(tableCell(new Date(Date.UTC(2024, 11, 31)))).toBe("2024-12-31");
    expect(tableCell(new Date(Date.UTC(2024, 11, 31, 9, 30)))).toBe("2024-12-31T09:30:00.000Z");
  });

  it("shows what the user sees for a formula, a hyperlink or rich text", () => {
    expect(excelCellText({ formula: "SUM(A1:A2)", result: 3 })).toBe("3");
    expect(excelCellText({ text: "Apple", hyperlink: "https://example.com" })).toBe("Apple");
    expect(excelCellText(" padded ")).toBe("padded");
    expect(cleanCell(null)).toBe("");
  });
});

describe("reading delimited text", () => {
  it("tells the delimiter apart from the text", () => {
    expect(sniffDelimiter("a;b;c\n1;2,5;3\n")).toBe(";");
    expect(sniffDelimiter("a\tb\n1\t2\n")).toBe("\t");
    expect(sniffDelimiter('name,note\n"Smith; John",ok\n')).toBe(",");
  });

  it("keeps ragged lines and strips a byte-order mark", () => {
    expect(readDelimited("﻿a,b\n1,2,3\nTotal\n")).toEqual([["a", "b"], ["1", "2", "3"], ["Total"]]);
  });
});

describe("reading a workbook", () => {
  it("returns every sheet with its cells as ExcelJS hands them over, dates included", async () => {
    const workbook = new ExcelJS.Workbook();
    const holdings = workbook.addWorksheet("Holdings");
    holdings.addRow(["Symbol", "Quantity", "Bought"]);
    holdings.addRow(["SPY", 1.5, new Date(Date.UTC(2023, 0, 3))]);
    workbook.addWorksheet("Secret", { state: "hidden" }).addRow(["x"]);

    const sheets = await readXlsxSheets(await workbook.xlsx.writeBuffer());
    expect(sheets.map(({ name, hidden }) => ({ name, hidden }))).toEqual([
      { name: "Holdings", hidden: false },
      { name: "Secret", hidden: true },
    ]);
    expect(sheets[0].rows[1].map(tableCell)).toEqual(["SPY", 1.5, "2023-01-03"]);
  });
});

describe("reading a table whole", () => {
  const bounds = { bytes: 64, rows: 2, columns: 3 };

  it("returns every row of a table inside the bounds", () => {
    expect(readCompleteDelimited("a,b,c\n1,2,3\n4,5,6\n", { label: "t.csv" }, bounds)).toEqual([["a", "b", "c"], ["1", "2", "3"], ["4", "5", "6"]]);
  });

  it("refuses a table one data row over, rather than returning the rows that fit", () => {
    const read = () => readCompleteDelimited("a\n1\n2\n3\n", { label: "t.csv" }, bounds);
    expect(read).toThrow(TableTooLarge);
    expect(read).toThrow("t.csv has 3 rows, over the 2-row limit for reading a table whole. Nothing was imported: split it into files of at most 2 rows and import each one.");
  });

  it("refuses a table whose widest row is over the column limit", () => {
    expect(() => readCompleteDelimited("a,b\n1,2,3,4\n", { label: "t.csv" }, bounds)).toThrow(/t\.csv has 4 columns, over the 3-column limit/);
  });

  it("refuses a file over the byte limit before reading it", () => {
    expect(() => checkTableBytes(64, "t.csv", bounds)).not.toThrow();
    expect(() => checkTableBytes(65, "t.csv", bounds)).toThrow(TableTooLarge);
    expect(() => checkTableBytes(21 * 1024 * 1024, "big.csv")).toThrow("big.csv is larger than the 20 MB limit for reading a table whole. Nothing was imported: split it into smaller files and import each one.");
    try {
      checkTableBytes(65, "t.csv", bounds);
    } catch (error) {
      expect(error).toMatchObject({ limit: "bytes", actual: 65, max: 64 });
    }
  });

  it("checks every sheet of a workbook", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Small").addRow(["a"]);
    const big = workbook.addWorksheet("Big");
    for (const row of [["a"], [1], [2], [3]]) big.addRow(row);
    const bytes = await workbook.xlsx.writeBuffer();
    await expect(readCompleteWorkbook(bytes, "w.xlsx", { ...bounds, bytes: 1024 * 1024 })).rejects.toThrow(/Sheet "Big" of w\.xlsx has 3 rows/);
    await expect(readCompleteWorkbook(bytes, "The workbook", bounds)).rejects.toThrow(/^The workbook is larger than/);
    await expect(readCompleteWorkbook(bytes, "The workbook", { ...bounds, bytes: 1024 * 1024 })).rejects.toThrow(/^Sheet "Big" of the workbook has 3 rows/);
  });
});

describe("reading a workbook whole from an untrusted zip", () => {
  async function holdings(): Promise<Uint8Array> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Holdings");
    sheet.addRow(["Symbol", "Shares"]);
    sheet.addRow(["AAPL", 12]);
    return new Uint8Array(await workbook.xlsx.writeBuffer());
  }

  /** A real workbook with filler entries added, so the entry count is the only thing wrong with it. */
  async function withEntries(total: number): Promise<Uint8Array> {
    const zip = await JSZip.loadAsync(await holdings());
    for (let index = Object.keys(zip.files).length; index < total; index++) zip.file(`filler-${index}.xml`, "<x/>");
    return zip.generateAsync({ type: "uint8array", compression: "STORE" });
  }

  it("refuses a workbook with more zip entries than the cap before ExcelJS opens it", async () => {
    const read = readCompleteWorkbook(await withEntries(MAX_ZIP_ENTRIES + 1), "bomb.xlsx");
    await expect(read).rejects.toBeInstanceOf(TableTooLarge);
    await expect(read).rejects.toMatchObject({ limit: "entries", actual: MAX_ZIP_ENTRIES + 1, max: MAX_ZIP_ENTRIES });
    await expect(read).rejects.toThrow(
      "bomb.xlsx holds 2,001 zip entries, over the 2,000-entry limit for reading a workbook. Nothing was imported: save the sheet you need as a CSV file and import that.",
    );
  });

  it("refuses a workbook whose central directory declares more than the decompressed-size cap", async () => {
    const read = readCompleteWorkbook(declareUncompressedSize(await holdings(), MAX_ZIP_DECOMPRESSED_BYTES), "bomb.xlsx");
    await expect(read).rejects.toBeInstanceOf(TableTooLarge);
    await expect(read).rejects.toMatchObject({ limit: "decompressedBytes", max: MAX_ZIP_DECOMPRESSED_BYTES });
    await expect(read).rejects.toThrow(
      "bomb.xlsx unpacks to more than the 200 MB limit for reading a workbook. Nothing was imported: save the sheet you need as a CSV file and import that.",
    );
  });

  it("still reads a workbook at the entry cap", async () => {
    const sheets = await readCompleteWorkbook(await withEntries(MAX_ZIP_ENTRIES), "book.xlsx");
    expect(sheets).toEqual([{ name: "Holdings", hidden: false, rows: [["Symbol", "Shares"], ["AAPL", 12]] }]);
  });
});
