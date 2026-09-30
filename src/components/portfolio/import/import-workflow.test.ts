import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImportPosition, PreviewPosition } from "@/lib/portfolio/types";
import {
  canCommit,
  chooseAccount,
  chooseHeaderRow,
  chooseSheet,
  commitPositions,
  committed,
  confirm,
  editCell,
  excludeRow,
  failed,
  flaggedRows,
  initialImport,
  loaded,
  mapColumn,
  mappingSuggested,
  parseSource,
  previewed,
  previewing,
  removeRow,
  requestMapping,
  requestPreview,
  started,
  type TableResponse,
  toImportPositions,
} from "./import-workflow";

const holdingsSheet: TableResponse = {
  headers: ["Symbol", "Qty", "Cost"],
  rows: [["AAPL", "10", "1500"], ["Total", "", "1500"]],
  allRows: [["Broker export"], ["Symbol", "Qty", "Cost"], ["AAPL", "10", "1500"], ["Total", "", "1500"]],
  source: "xlsx",
  sheetName: "Holdings",
  mapping: { symbol: "Symbol", quantity: "Qty", costBasis: "Cost" },
};
const cashSheet: TableResponse = { headers: ["Currency", "Amount"], rows: [["USD", "5"]], source: "xlsx", sheetName: "Cash", mapping: {} };

const accepted: ImportPosition = {
  symbol: "AAPL",
  name: "AAPL",
  quantity: 10,
  price: null,
  marketValue: null,
  costBasis: 1500,
  currency: "USD",
  assetType: "security",
};
const flaggedTotal: PreviewPosition = {
  rowNumber: 3,
  symbol: null,
  name: "Total",
  quantity: null,
  price: null,
  marketValue: null,
  costBasis: 1500,
  currency: "USD",
  assetType: "custom",
  warnings: [],
  errors: ["Row 3 needs a quantity or a market value."],
};

/** Stands in for `fetch`, recording each request and answering with `body`. */
function answering(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
  return { calls, sent: (index = 0) => JSON.parse(String(calls[index]?.init.body)) };
}

/** Parsed, previewed with the total row flagged, AAPL ready for review. */
function reviewing() {
  const parsed = loaded(started(initialImport("acc-1")), [holdingsSheet, cashSheet]);
  return previewed(previewing(parsed), { positions: [accepted], preview: [flaggedTotal], errors: [] });
}

describe("import workflow stages", () => {
  it("goes from source to mapping to review", () => {
    const empty = initialImport("acc-1");
    expect(empty).toMatchObject({ table: null, rows: [] });
    const parsed = loaded(started(empty), [holdingsSheet, cashSheet]);
    expect(parsed).toMatchObject({ table: holdingsSheet, mapping: holdingsSheet.mapping, busy: false, isError: false });
    expect(parsed.status).toBe("Loaded 2 rows. Review the mapping, then generate a preview.");
    const review = reviewing();
    expect(review.rows).toEqual([{ symbol: "AAPL", name: "AAPL", quantity: "10", price: "", marketValue: "", costBasis: "1500", currency: "USD" }]);
    expect(review.status).toBe("1 positions ready for review.");
    expect(canCommit(review)).toBe(true);
  });

  it("refuses a source with no worksheet, keeping what was there", () => {
    const parsed = loaded(initialImport("acc-1"), [holdingsSheet]);
    const empty = loaded(started(parsed), []);
    expect(empty).toMatchObject({ isError: true, busy: false, status: "No worksheet or rows found.", table: holdingsSheet });
  });

  it("starts a request by clearing the message and holding the controls", () => {
    const shown = failed(initialImport("acc-1"), "Could not parse holdings.");
    expect(started(shown)).toMatchObject({ busy: true, status: "", isError: false });
    expect(previewing({ ...shown, draftErrors: ["Row 1: Quantity is not a number (\"x\")."] }).draftErrors).toEqual([]);
  });

  it("starts over when the account changes", () => {
    const review = reviewing();
    const moved = chooseAccount(review, "acc-2");
    expect(moved).toMatchObject({ accountId: "acc-2", table: null, rows: [], tables: [], mapping: {} });
  });
});

describe("mapping correction", () => {
  it("maps and unmaps columns by hand, and takes the model's suggestion", () => {
    const parsed = loaded(initialImport("acc-1"), [holdingsSheet]);
    const corrected = mapColumn(mapColumn(parsed, "price", "Cost"), "costBasis", "");
    expect(corrected.mapping).toEqual({ symbol: "Symbol", quantity: "Qty", price: "Cost", costBasis: undefined });
    const suggested = mappingSuggested(started(parsed), { symbol: "Symbol", marketValue: "Cost" });
    expect(suggested).toMatchObject({ busy: false, mapping: { symbol: "Symbol", marketValue: "Cost" } });
  });

  it("drops the review when the worksheet changes, and maps the new one with its own guess", () => {
    const review = reviewing();
    const switched = chooseSheet(review, "Cash");
    expect(switched).toMatchObject({ table: cashSheet, mapping: {}, headerIndex: 0, rows: [], previewRows: [], excludedRows: [] });
    expect(chooseSheet(review, "Missing")).toBe(review);
  });

  it("re-reads the table under a different header row and clears the mapping", () => {
    const parsed = loaded(initialImport("acc-1"), [{ ...holdingsSheet, headers: ["Broker export"], rows: holdingsSheet.allRows!.slice(1) }]);
    const fixed = chooseHeaderRow(parsed, 1);
    expect(fixed.headerIndex).toBe(1);
    expect(fixed.table?.headers).toEqual(["Symbol", "Qty", "Cost"]);
    expect(fixed.table?.rows).toEqual([["AAPL", "10", "1500"], ["Total", "", "1500"]]);
    expect(fixed.mapping).toEqual({});
  });
});

describe("preview and row errors", () => {
  it("flags source rows and lets them be excluded before previewing again", () => {
    const review = reviewing();
    expect(flaggedRows(review)).toEqual([flaggedTotal]);
    const excluded = excludeRow(review, 3, true);
    expect(excluded.excludedRows).toEqual([3]);
    expect(excludeRow(excluded, 3, false).excludedRows).toEqual([]);
  });

  it("blocks confirm while the preview reports errors", () => {
    const parsed = loaded(initialImport("acc-1"), [holdingsSheet]);
    const blocked = previewed(parsed, { positions: [accepted], preview: [flaggedTotal], errors: ["Row 3 needs a quantity or a market value."] });
    expect(blocked).toMatchObject({ isError: true, status: "Fix or exclude the flagged rows, then preview again." });
    expect(canCommit(blocked)).toBe(false);
    const result = confirm(blocked);
    expect(result.ready).toBeNull();
    expect(result.state.status).toBe("Choose an account and resolve all preview errors before confirming.");
  });

  it("edits a cell in place and removes a row", () => {
    const review = previewed(loaded(initialImport("acc-1"), [holdingsSheet]), { positions: [accepted, { ...accepted, symbol: "MSFT", name: "MSFT" }], preview: [] });
    const edited = editCell(review, 1, "quantity", "1.");
    expect(edited.rows[1].quantity).toBe("1.");
    expect(edited.rows[0]).toBe(review.rows[0]);
    expect(removeRow(edited, 0).rows.map((row) => row.symbol)).toEqual(["MSFT"]);
  });

  it("names every cell that is not a number, and every row missing what the ledger needs", () => {
    const { positions, errors } = toImportPositions([
      { symbol: "AAPL", name: "", quantity: "1,000", price: "", marketValue: "", costBasis: "15,000.5", currency: "usd" },
      { symbol: "MSFT", name: "", quantity: "ten", price: "", marketValue: "", costBasis: "", currency: "" },
      { symbol: "", name: "", quantity: "1", price: "", marketValue: "", costBasis: "", currency: "" },
      { symbol: "", name: "Private fund", quantity: "", price: "", marketValue: "", costBasis: "", currency: "" },
      { symbol: "", name: "Art", quantity: "", price: "", marketValue: "25000", costBasis: "", currency: "" },
    ]);
    expect(errors).toEqual([
      'Row 2: Quantity is not a number ("ten").',
      "Row 3 needs a ticker or an asset name.",
      "Row 4 needs a quantity or a market value.",
    ]);
    expect(positions).toEqual([
      { symbol: "AAPL", name: "AAPL", quantity: 1000, price: null, marketValue: null, costBasis: 15000.5, currency: "USD", assetType: "security" },
      { symbol: null, name: "Art", quantity: null, price: null, marketValue: 25000, costBasis: null, currency: "USD", assetType: "custom" },
    ]);
  });

  it("holds a confirm back with the cell errors listed, and sends once they are fixed", () => {
    const review = editCell(reviewing(), 0, "costBasis", "12O0");
    const held = confirm(review);
    expect(held.ready).toBeNull();
    expect(held.state).toMatchObject({ isError: true, status: "Correct the cells listed below, then confirm again." });
    expect(held.state.draftErrors).toEqual(['Row 1: Cost basis is not a number ("12O0").']);

    const fixed = confirm(editCell(held.state, 0, "costBasis", "1200"));
    expect(fixed.ready).toEqual([{ ...accepted, costBasis: 1200 }]);
    expect(fixed.state.draftErrors).toEqual([]);
  });

  it("needs an account to confirm", () => {
    const review = { ...reviewing(), accountId: "" };
    expect(canCommit(review)).toBe(false);
    expect(confirm(review).ready).toBeNull();
  });
});

describe("requests", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses a source and surfaces the server's error", async () => {
    const ok = answering({ tables: [holdingsSheet] });
    const form = new FormData();
    form.append("text", "Symbol,Qty\nAAPL,10");
    expect(await parseSource(form)).toEqual([holdingsSheet]);
    expect(ok.calls[0]).toMatchObject({ url: "/api/portfolio/parse", init: { method: "POST", body: form } });
    answering({ error: "File too large." }, 413);
    await expect(parseSource(form)).rejects.toThrow("File too large.");
    answering({}, 500);
    await expect(parseSource(form)).rejects.toThrow("Request failed (500)");
  });

  it("previews with the table, mapping, cost mode and exclusions on screen", async () => {
    const state = excludeRow(mapColumn(loaded(initialImport("acc-1"), [holdingsSheet]), "price", "Cost"), 3, true);
    const api = answering({ positions: [accepted], preview: [], errors: [] });
    await requestPreview(state);
    expect(api.calls[0].url).toBe("/api/portfolio/preview");
    expect(api.sent()).toEqual({ table: holdingsSheet, mapping: { ...holdingsSheet.mapping, price: "Cost" }, costBasisMode: "total", excludedRows: [3] });
  });

  it("asks for a mapping from the headers and the first three rows", async () => {
    const api = answering({ mapping: { symbol: "Symbol" } });
    const table = { ...holdingsSheet, rows: [["A"], ["B"], ["C"], ["D"]] };
    expect(await requestMapping(table)).toEqual({ symbol: "Symbol" });
    expect(api.sent()).toEqual({ headers: holdingsSheet.headers, samples: [["A"], ["B"], ["C"]] });
  });

  it("commits to the account with the source and the preview's key, and retries under the same key", async () => {
    const review = reviewing();
    const { ready, state } = confirm(review);
    if (ready === null) throw new Error("expected the review to be ready");

    // The first attempt's response is lost: the server may already have recorded it.
    const lost = answering({ error: "The ledger is busy." }, 503);
    await expect(commitPositions(started(state), ready)).rejects.toThrow("The ledger is busy.");
    const afterFailure = failed(started(state), "The ledger is busy.");
    // Nothing is lost: the rows are still there to confirm again.
    expect(afterFailure.rows).toEqual(review.rows);
    expect(canCommit(afterFailure)).toBe(true);

    const retried = confirm(afterFailure);
    if (retried.ready === null) throw new Error("expected the retry to be ready");
    const api = answering({ ok: true });
    await commitPositions(started(retried.state), retried.ready);
    expect(api.calls[0].url).toMatch(/^\/api\/portfolio\/commit\?today=\d{4}-\d{2}-\d{2}$/);
    const key = lost.sent().idempotencyKey;
    expect(key).toEqual(expect.any(String));
    expect(key).toBe(review.commitKey);
    expect(api.sent()).toEqual({ accountId: "acc-1", positions: ready, source: "xlsx", idempotencyKey: key });
    const done = committed(afterFailure);
    expect(done).toMatchObject({ rows: [], table: null, busy: false, accountId: "acc-1", commitKey: null });
  });

  it("commits a new preview, or edited rows, under a new key", async () => {
    const review = reviewing();
    expect(review.commitKey).toEqual(expect.any(String));
    const remapped = mapColumn(review, "price", "Cost");
    expect(remapped.commitKey).toBe(review.commitKey);
    const repreviewed = previewed(previewing(remapped), { positions: [{ ...accepted, price: 1500 }], preview: [], errors: [] });
    expect(repreviewed.commitKey).toEqual(expect.any(String));
    expect(repreviewed.commitKey).not.toBe(review.commitKey);

    const edited = editCell(repreviewed, 0, "quantity", "12");
    expect(edited.commitKey).not.toBe(repreviewed.commitKey);
    expect(removeRow(edited, 0).commitKey).not.toBe(edited.commitKey);

    const { ready, state } = confirm(repreviewed);
    if (ready === null) throw new Error("expected the review to be ready");
    const api = answering({ ok: true });
    await commitPositions(state, ready);
    expect(api.sent().idempotencyKey).toBe(repreviewed.commitKey);
  });

  it("will not commit without a preview's key", async () => {
    const api = answering({ ok: true });
    await expect(commitPositions(initialImport("acc-1"), [accepted])).rejects.toThrow("Preview the holdings before recording the import.");
    expect(api.calls).toEqual([]);
  });
});
