import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeRows, parseCsv, suggestMapping } from "./parser";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("portfolio import fixture", () => {
  it("covers valid, custom, value-only, derived and invalid rows", () => {
    const file = path.join(here, "fixtures", "portfolio-import-usd-only.csv");
    const table = parseCsv(readFileSync(file, "utf8"));
    const rows = normalizeRows(table, suggestMapping(table.headers), "total");
    expect(rows).toHaveLength(13);
    expect(rows.find((row) => row.rowNumber === 2)).toMatchObject({ symbol: "NKE", name: "Nike", marketValue: 750 });
    expect(rows.find((row) => row.rowNumber === 7)).toMatchObject({ symbol: null, name: "Private Company Note", assetType: "custom" });
    expect(rows.find((row) => row.rowNumber === 6)).toMatchObject({ name: "Cash Reserve", quantity: null, marketValue: 2500 });
    expect(rows.find((row) => row.rowNumber === 8)).toMatchObject({ symbol: "NVDA", marketValue: 480 });
    expect(rows.find((row) => row.rowNumber === 14)?.errors.join(" ")).toContain("Price is not a valid number");
    expect(rows.find((row) => row.rowNumber === 13)?.errors.join(" ")).toContain("Quantity or market value is required");
  });
});
