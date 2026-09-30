import { describe, expect, it } from "vitest";
import { csvText, parseCsvBody, parseCsvRow, rowDay, trimCsvRows } from "./csv";

const daily = [
  "timestamp,open,high,low,close,volume",
  "2026-09-11,170.0,172.0,169.0,171.5,1000",
  "2024-08-29,120.0,122.0,119.0,121.5,2000",
  "2024-08-28,118.0,121.0,117.5,120.0,3000",
].join("\n");

const treasury = ["timestamp,value", "2026-09-11,4.10", "2024-08-29,3.90"].join("\n");

describe("parseCsvBody", () => {
  it("finds the column that dates each row", () => {
    const body = parseCsvBody(daily);
    expect(body?.header).toEqual(["timestamp", "open", "high", "low", "close", "volume"]);
    expect(body?.dateColumn).toBe(0);
    expect(body?.rows).toHaveLength(3);
  });

  it("accepts the macro and calendar headers too", () => {
    expect(parseCsvBody(treasury)?.dateColumn).toBe(0);
    expect(parseCsvBody("symbol,name,reportDate\nIBM,IBM Corp,2025-07-23")?.dateColumn).toBe(2);
  });

  it("refuses anything it cannot place in time", () => {
    expect(parseCsvBody(JSON.stringify({ a: 1 }))).toBeNull();
    expect(parseCsvBody("symbol,name\nIBM,IBM Corp")).toBeNull();
    expect(parseCsvBody("timestamp,open,high,low,close,volume")).toBeNull();
    expect(parseCsvBody("just prose")).toBeNull();
    expect(parseCsvBody("")).toBeNull();
  });

  it("keeps quoted cells intact", () => {
    const body = parseCsvBody('symbol,name,reportDate\nIBM,"Business Machines, Inc.",2025-07-23');
    expect(body?.rows[0]).toEqual(["IBM", "Business Machines, Inc.", "2025-07-23"]);
  });
});

describe("trimCsvRows", () => {
  it("drops rows dated after the cutoff", () => {
    const body = parseCsvBody(daily);
    if (!body) throw new Error("expected a CSV body");
    const trimmed = trimCsvRows(body, "2024-08-29");
    expect(trimmed.changed).toBe(true);
    expect(trimmed.rows.map((row) => rowDay(body, row))).toEqual(["2024-08-29", "2024-08-28"]);
  });

  it("leaves a body that is already inside the cutoff alone", () => {
    const body = parseCsvBody(daily);
    if (!body) throw new Error("expected a CSV body");
    expect(trimCsvRows(body, "2026-12-31").changed).toBe(false);
  });

  it("drops a row whose date will not parse, since it cannot be shown to predate the cutoff", () => {
    const body = parseCsvBody("timestamp,value\n2024-08-29,3.90\n.,.");
    if (!body) throw new Error("expected a CSV body");
    const trimmed = trimCsvRows(body, "2024-08-29");
    expect(trimmed.rows).toHaveLength(1);
  });
});

describe("csvText", () => {
  it("rebuilds the body from the original header and row text", () => {
    const body = parseCsvBody(daily);
    if (!body) throw new Error("expected a CSV body");
    const trimmed = trimCsvRows(body, "2024-08-29");
    expect(csvText(body, trimmed.lines)).toBe(
      ["timestamp,open,high,low,close,volume", "2024-08-29,120.0,122.0,119.0,121.5,2000", "2024-08-28,118.0,121.0,117.5,120.0,3000"].join(
        "\n",
      ),
    );
  });
});

describe("parseCsvRow", () => {
  it("unescapes doubled quotes", () => {
    expect(parseCsvRow('a,"b ""x"", c",d')).toEqual(["a", 'b "x", c', "d"]);
  });
});
