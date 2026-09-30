import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HoldingComparison, HoldingsView } from "@/lib/portfolio/holdings";
import type { Account, ColumnMapping, ImportBatch, ImportPosition, PreviewPosition, RawTable } from "@/lib/portfolio/types";

let home: string;

beforeAll(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-portfolio-import-"));
  process.env.OFA_HOME = home;
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
  delete process.env.OFA_HOME;
});

type ParsedTable = RawTable & { mapping: ColumnMapping };

const json = (url: string, body: unknown) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function createAccount(name: string): Promise<Account> {
  const { POST } = await import("./accounts/route");
  const res = await POST(
    json("http://localhost/api/portfolio/accounts", {
      name,
      type: "taxable",
      baseCurrency: "USD",
      costBasisMethod: "fifo",
    }),
  );
  return ((await res.json()) as { account: Account }).account;
}

const parseRequest = (file: File) => {
  const form = new FormData();
  form.append("file", file);
  return new Request("http://localhost/api/portfolio/parse", { method: "POST", body: form });
};

async function holdingsWorkbook(): Promise<Uint8Array<ArrayBuffer>> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Holdings");
  sheet.addRow(["Ticker", "Quantity"]);
  sheet.addRow(["NKE", 10]);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

/** Walks a CSV through parse and preview, the way the import dialog does. */
async function previewCsv(
  csv: string,
): Promise<{ table: ParsedTable; positions: ImportPosition[]; preview: PreviewPosition[] }> {
  const parse = await import("./parse/route");
  const preview = await import("./preview/route");

  const form = new FormData();
  form.append("file", new File([csv], "holdings.csv", { type: "text/csv" }));
  const parsed = (await (
    await parse.POST(new Request("http://localhost/api/portfolio/parse", { method: "POST", body: form }))
  ).json()) as { tables: ParsedTable[] };
  const table = parsed.tables[0];

  const body = (await (
    await preview.POST(
      json("http://localhost/api/portfolio/preview", { table, mapping: table.mapping, costBasisMode: "total" }),
    )
  ).json()) as { preview: PreviewPosition[]; positions: ImportPosition[] };
  return { table, preview: body.preview, positions: body.positions };
}

describe("/api/portfolio import routes", () => {
  it("parses a CSV, guesses its columns and previews it as numbers", async () => {
    const { table, preview, positions } = await previewCsv(
      ["Ticker,Description,Quantity,Last Price,Cost Basis", "NKE,Nike,10,75.00,650.00"].join("\n"),
    );
    expect(table.source).toBe("csv");
    expect(table.mapping).toMatchObject({ symbol: "Ticker", name: "Description", quantity: "Quantity" });
    expect(preview[0]).toMatchObject({ rowNumber: 2, symbol: "NKE", quantity: 10, costBasis: 650, marketValue: 750 });
    expect(positions).toHaveLength(1);
    expect(positions[0].quantity).toBe(10);
  });

  it("refuses a table over the row limit whole, naming the limit, instead of returning its first rows", async () => {
    const { POST } = await import("./parse/route");
    const { MAX_TABLE_ROWS } = await import("@/lib/attachments/limits");
    const csv = ["Ticker,Quantity", ...Array.from({ length: MAX_TABLE_ROWS + 1 }, (_, index) => `T${index},1`)].join("\n");
    const form = new FormData();
    form.append("file", new File([csv], "holdings.csv", { type: "text/csv" }));
    const res = await POST(new Request("http://localhost/api/portfolio/parse", { method: "POST", body: form }));
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string; tables?: unknown };
    expect(body.tables).toBeUndefined();
    expect(body.error).toBe(
      "holdings.csv has 50,001 rows, over the 50,000-row limit for reading a table whole. Nothing was imported: split it into files of at most 50,000 rows and import each one.",
    );
  });

  it("parses a normal .xlsx workbook", async () => {
    const { POST } = await import("./parse/route");
    const res = await POST(parseRequest(new File([await holdingsWorkbook()], "holdings.xlsx")));
    expect(res.status).toBe(200);
    const { tables } = (await res.json()) as { tables: ParsedTable[] };
    expect(tables).toHaveLength(1);
    expect(tables[0]).toMatchObject({ source: "xlsx", sheetName: "Holdings", headers: ["Ticker", "Quantity"] });
    expect(tables[0].rows).toEqual([["NKE", "10"]]);
  });

  it("refuses an .xlsx zip bomb by its central directory with a 413 naming the limit", async () => {
    const { POST } = await import("./parse/route");
    const { MAX_ZIP_DECOMPRESSED_BYTES, MAX_ZIP_ENTRIES } = await import("@/lib/attachments/limits");
    const { declareUncompressedSize } = await import("@/lib/attachments/parse/fixtures/pptx-decks");

    const zip = await JSZip.loadAsync(await holdingsWorkbook());
    for (let index = 0; index <= MAX_ZIP_ENTRIES; index++) zip.file(`filler-${index}.xml`, "<x/>");
    const crowded = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
    const inflated = declareUncompressedSize(await holdingsWorkbook(), MAX_ZIP_DECOMPRESSED_BYTES);

    for (const [name, bytes, error] of [
      ["crowded.xlsx", crowded, /^crowded\.xlsx holds [\d,]+ zip entries, over the 2,000-entry limit for reading a workbook\. Nothing was imported/],
      ["inflated.xlsx", inflated, /^inflated\.xlsx unpacks to more than the 200 MB limit for reading a workbook\. Nothing was imported/],
    ] as const) {
      const res = await POST(parseRequest(new File([new Uint8Array(bytes)], name)));
      expect(res.status, name).toBe(413);
      const body = (await res.json()) as { error: string; tables?: unknown };
      expect(body.tables).toBeUndefined();
      expect(body.error).toMatch(error);
    }
  });

  it("refuses a file type it cannot read", async () => {
    const { POST } = await import("./parse/route");
    const form = new FormData();
    form.append("file", new File(["x"], "holdings.pdf", { type: "application/pdf" }));
    const res = await POST(new Request("http://localhost/api/portfolio/parse", { method: "POST", body: form }));
    expect(res.status).toBe(400);
  });

  it("commits an import, is idempotent, and replays it as current holdings", async () => {
    const commit = await import("./commit/route");
    const current = await import("./current/route");
    const account = await createAccount("Import brokerage");

    const { positions } = await previewCsv(
      [
        "Ticker,Description,Quantity,Last Price,Cost Basis,Market Value",
        "NKE,Nike,10,75.00,650.00,750.00",
        "MSFT,Microsoft Corp,4,425.00,1600.00,1700.00",
        ",Cash Reserve,,,,2500.00",
      ].join("\n"),
    );
    expect(positions).toHaveLength(3);

    const body = { accountId: account.id, positions, source: "csv", idempotencyKey: "first-import-0001" };
    const created = await commit.POST(json("http://localhost/api/portfolio/commit", body));
    expect(created.status).toBe(201);
    const first = (await created.json()) as { batch: ImportBatch; reused: boolean; transactionCount: number };
    expect(first.reused).toBe(false);
    expect(first.batch.count).toBe(3);
    expect(first.transactionCount).toBe(3);

    // The same key again is the same batch and writes nothing: a retried request cannot double a position.
    const again = await commit.POST(json("http://localhost/api/portfolio/commit", body));
    expect(again.status).toBe(200);
    const repeat = (await again.json()) as { batch: ImportBatch; reused: boolean };
    expect(repeat.reused).toBe(true);
    expect(repeat.batch.id).toBe(first.batch.id);

    const view = (await (
      await current.GET(new Request(`http://localhost/api/portfolio/current?accountId=${account.id}`))
    ).json()) as HoldingsView;
    expect(view.holdings.map((holding) => holding.position.instrument.symbol).sort()).toEqual(["MSFT", "NKE"]);
    expect(view.holdings.every((holding) => holding.accountName === "Import brokerage")).toBe(true);
    // The value-only row is money, not a position.
    expect(view.cash).toEqual([
      { accountId: account.id, accountName: "Import brokerage", institution: undefined, balance: { accountId: account.id, currency: "USD", amount: 2500 } },
    ]);
  });

  it("narrows current holdings to one symbol and rejects a symbol that is not one", async () => {
    const { GET } = await import("./current/route");
    const view = (await (await GET(new Request("http://localhost/api/portfolio/current?symbol=nke"))).json()) as HoldingsView;
    expect(view.holdings).toHaveLength(1);
    expect(view.holdings[0].position.instrument.symbol).toBe("NKE");
    // A symbol query is about one security, so cash is not part of the answer.
    expect(view.cash).toEqual([]);

    expect((await GET(new Request("http://localhost/api/portfolio/current?symbol=NKE%20OR%201"))).status).toBe(400);
  });

  it("serves an account's import history", async () => {
    const { GET } = await import("./[accountId]/route");
    const accounts = await import("./accounts/route");
    const listed = (await (await accounts.GET()).json()) as { accounts: Account[] };
    const account = listed.accounts.find((candidate) => candidate.name === "Import brokerage");
    expect(account).toBeDefined();

    const res = await GET(new Request("http://localhost/x"), { params: Promise.resolve({ accountId: account?.id ?? "" }) });
    const body = (await res.json()) as { batches: ImportBatch[] };
    expect(body.batches).toHaveLength(1);

    const missing = await GET(new Request("http://localhost/x"), { params: Promise.resolve({ accountId: "nope" }) });
    expect(missing.status).toBe(404);
  });

  it("compares two imports of one account by their batch ids", async () => {
    const commit = await import("./commit/route");
    const compare = await import("./compare/route");
    const detail = await import("./[accountId]/route");
    const account = await createAccount("Compare brokerage");

    const first = await previewCsv(
      ["Ticker,Description,Quantity,Cost Basis", "NKE,Nike,10,650.00", "MSFT,Microsoft Corp,4,1600.00"].join("\n"),
    );
    await commit.POST(
      json("http://localhost/api/portfolio/commit", {
        accountId: account.id,
        positions: first.positions,
        source: "csv",
        idempotencyKey: "compare-first-0001",
      }),
    );

    const second = await previewCsv(
      ["Ticker,Description,Quantity,Cost Basis", "NKE,Nike,25,1650.00", "NVDA,NVIDIA,3,400.00"].join("\n"),
    );
    await commit.POST(
      json("http://localhost/api/portfolio/commit", {
        accountId: account.id,
        positions: second.positions,
        source: "csv",
        idempotencyKey: "compare-second-0001",
      }),
    );

    const body = (await (
      await detail.GET(new Request("http://localhost/x"), { params: Promise.resolve({ accountId: account.id }) })
    ).json()) as { batches: ImportBatch[] };
    expect(body.batches).toHaveLength(2);
    const [after, before] = body.batches;

    const res = await compare.POST(
      json("http://localhost/api/portfolio/compare", {
        accountId: account.id,
        beforeBatchId: before.id,
        afterBatchId: after.id,
      }),
    );
    const { comparison } = (await res.json()) as { comparison: HoldingComparison };
    expect(comparison.changes.map((change) => [change.symbol, change.status])).toEqual([
      ["MSFT", "removed"],
      ["NKE", "changed"],
      ["NVDA", "added"],
    ]);
    expect(comparison.changes[1]).toMatchObject({ quantityDelta: 15, costBasisDelta: 1_000 });

    const unknown = await compare.POST(
      json("http://localhost/api/portfolio/compare", {
        accountId: account.id,
        beforeBatchId: "nope",
        afterBatchId: after.id,
      }),
    );
    expect(unknown.status).toBe(404);
  });

  it("rejects a commit for an unknown account and a body that is not declared JSON", async () => {
    const { POST } = await import("./commit/route");
    const refused = await POST(
      json("http://localhost/api/portfolio/commit", {
        accountId: "nope",
        positions: [],
        source: "csv",
        idempotencyKey: "unknown-account-0001",
      }),
    );
    expect(refused.status).toBe(500);
    expect(((await refused.json()) as { error: string }).error).toContain("No account nope");

    const plain = await POST(new Request("http://localhost/api/portfolio/commit", { method: "POST", body: "{}" }));
    expect(plain.status).toBe(415);
  });

  it("rejects a preview body the schema does not accept", async () => {
    const { POST } = await import("./preview/route");
    const res = await POST(json("http://localhost/api/portfolio/preview", { table: { headers: [] }, mapping: {} }));
    expect(res.status).toBe(400);
  });
});
