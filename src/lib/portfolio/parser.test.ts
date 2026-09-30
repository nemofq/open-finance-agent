import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { MAX_TABLE_COLUMNS, MAX_TABLE_ROWS } from "@/lib/attachments/limits";
import { TableTooLarge } from "@/lib/attachments/tables";
import {
  normalizeRows,
  parseCsv,
  parsePastedTable,
  parseXlsx,
  suggestMapping,
  validatePositions,
} from "./parser";

describe("portfolio parser", () => {
  it("suggests common brokerage headers and calculates missing market value", () => {
    const table = parseCsv("Ticker,Description,Shares,Last Price,Cost Basis,CCY\nAAPL,Apple Inc,2,100,150,USD\nMystery,Thing,,25,20,USD");
    const preview = normalizeRows(table, suggestMapping(table.headers), "total");
    expect(preview[0]).toMatchObject({ symbol: "AAPL", quantity: 2, marketValue: 200, costBasis: 150, currency: "USD" });
    expect(preview[0].warnings).toContain("Market value calculated from quantity × price.");
    expect(preview[1].marketValue).toBeNull();
  });

  it("supports pasted tab-separated holdings and per-unit cost basis", () => {
    const table = parsePastedTable("Symbol\tName\tQty\tPrice\tAvg Cost\nMSFT\tMicrosoft\t3\t10\t4");
    const preview = normalizeRows(table, suggestMapping(table.headers), "per_unit");
    expect(preview[0].costBasis).toBe(12);
  });

  it("reads every row in USD, whatever a currency column says", () => {
    const table = parseCsv("Ticker,Name,Quantity,Price,Currency\nBND,Bond ETF,2,80,EUR");
    const preview = normalizeRows(table, suggestMapping(table.headers), "total");
    expect(preview[0].currency).toBe("USD");
  });

  it("reads every xlsx worksheet", async () => {
    const workbook = new ExcelJS.Workbook();
    const holdings = workbook.addWorksheet("Holdings");
    holdings.addRow(["Symbol", "Quantity"]);
    holdings.addRow(["SPY", 1]);
    const other = workbook.addWorksheet("Other");
    other.addRow(["Name", "Value"]);
    other.addRow(["Cash", 50]);
    const tables = await parseXlsx(await workbook.xlsx.writeBuffer());
    expect(tables.map((table) => table.sheetName)).toEqual(["Holdings", "Other"]);
    expect(tables[0].rows[0]).toEqual(["SPY", "1"]);
  });

  it("rejects positions with neither quantity nor market value", () => {
    expect(() => validatePositions([{ symbol: null, name: "Unknown", quantity: null, price: null, marketValue: null, costBasis: null, currency: "USD", assetType: "custom" }])).toThrow(/quantity or market value/);
  });
});

/**
 * An import is a statement of the whole account: a later import zeroes positions the file omits, so
 * committing the first N rows of a longer file would sell off the rest. A table is read whole or the
 * file is refused with the limit named; there is no third outcome.
 */
describe("portfolio import reads a table whole or not at all", () => {
  const holdings = (rows: number) => ["Ticker,Quantity", ...Array.from({ length: rows }, (_, index) => `T${index},1`)].join("\n");

  it("returns every row of a table at the row limit", () => {
    const table = parseCsv(holdings(MAX_TABLE_ROWS), "holdings.csv");
    expect(table.rows).toHaveLength(MAX_TABLE_ROWS);
    expect(table.rows.at(-1)).toEqual([`T${MAX_TABLE_ROWS - 1}`, "1"]);
  });

  it("refuses a csv one row over the limit rather than returning its first rows", () => {
    expect(() => parseCsv(holdings(MAX_TABLE_ROWS + 1), "holdings.csv")).toThrow(TableTooLarge);
    expect(() => parseCsv(holdings(MAX_TABLE_ROWS + 1), "holdings.csv")).toThrow(/holdings\.csv has 50,001 rows, over the 50,000-row limit/);
  });

  it("refuses a pasted table over the column limit", () => {
    const wide = Array.from({ length: MAX_TABLE_COLUMNS + 1 }, (_, index) => `C${index}`).join("\t");
    expect(() => parsePastedTable(`${wide}\n${wide}`)).toThrow(/The pasted table has 201 columns, over the 200-column limit/);
  });

  it("refuses a workbook when any sheet is over the limit, naming the sheet", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Cash").addRow(["Name", "Value"]);
    const positions = workbook.addWorksheet("Positions");
    positions.addRow(["Symbol", "Quantity"]);
    for (let index = 0; index <= MAX_TABLE_ROWS; index++) positions.addRow([`T${index}`, 1]);
    const bytes = await workbook.xlsx.writeBuffer();
    await expect(parseXlsx(bytes, "broker.xlsx")).rejects.toThrow(/Sheet "Positions" of broker\.xlsx has 50,001 rows/);
  });
});
