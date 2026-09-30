import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerAttachment } from "@/lib/attachments/evidence";
import { readParsed } from "@/lib/attachments/documents";
import { attachDocument } from "@/lib/attachments/testing";
import type { StoredAttachment } from "@/lib/attachments/types";
import { createLedger } from "@/lib/evidence/ledger";
import type { EvidenceLedger } from "@/lib/evidence/types";
import type { FinanceTool, ModuleContext } from "@/lib/tools/contracts";
import { attachmentsModule, findDocument, findPart } from "./tool";

let home: string;
let session: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-read-attachment-"));
  process.env.OFA_HOME = home;
  session = randomUUID();
});

afterEach(() => {
  delete process.env.OFA_HOME;
  rmSync(home, { recursive: true, force: true });
});

const report = [
  "# Annual report",
  "",
  "## Overview",
  "",
  "The year was steady. ".repeat(400),
  "",
  "## Data center",
  "",
  `Data center revenue reached $30,040M, up 56% on the year. ${"Filler. ".repeat(400)}`,
].join("\n");

const csv = "date,ticker,shares\n2026-01-02,NVDA,400\n2026-02-02,MSFT,120";

function context(documents: StoredAttachment[], evidence = createLedger({ sessionId: session })): ModuleContext {
  return {
    log: () => undefined,
    session: { id: session },
    documents,
    evidence,
  };
}

async function toolFor(documents: StoredAttachment[], evidence?: EvidenceLedger): Promise<FinanceTool> {
  const [tool] = await attachmentsModule.createTools({ enabled: true }, context(documents, evidence));
  return tool;
}

async function run(tool: FinanceTool, args: Record<string, unknown>): Promise<string> {
  const result = await tool.execute("call-1", args as never, new AbortController().signal);
  return result.content.map((block) => (block.type === "text" ? block.text : "")).join("\n");
}

/** Register the file the way a turn does, so the tool can name the ids the digests were given. */
async function ledgerWith(documents: StoredAttachment[]): Promise<EvidenceLedger> {
  const ledger = createLedger({ sessionId: session, dataDir: home });
  for (const document of documents) registerAttachment(ledger, document, await readParsed(session, document.attachment));
  await ledger.flush();
  return ledger;
}

describe("createTools", () => {
  it("offers nothing to a chat with no documents in it", async () => {
    expect(await attachmentsModule.createTools({ enabled: true }, context([]))).toEqual([]);
  });

  it("names the files it can read, so the model knows what to ask for", async () => {
    const memo = await attachDocument(session, "Q3 memo.md", report);
    const tool = await toolFor([memo]);

    expect(tool.name).toBe("read_attachment");
    expect(tool.description).toContain("Q3 memo.md");
    expect(tool.meta).toMatchObject({ class: "general", effect: "read" });
    expect(tool.meta.source?.tier).toBe(4);
  });
});

describe("read_attachment", () => {
  it("returns the top of the document when asked for nothing in particular", async () => {
    const memo = await attachDocument(session, "annual.md", report);
    const text = await run(await toolFor([memo]), { name: "annual.md", maxChars: 1_000 });

    expect(text).toContain("annual.md — 1 section");
    expect(text).toContain("# Annual report");
    expect(text).toContain("[truncated:");
    expect(text).toContain("Pass a query");
  });

  it("returns the passages that match a query, labelled with where they are", async () => {
    const memo = await attachDocument(session, "annual.md", report);
    const text = await run(await toolFor([memo]), { name: "annual.md", query: "data center revenue" });

    expect(text).toContain("$30,040M");
    expect(text).toMatch(/\[Document · chunk \d+\/\d+\]/);
  });

  it("says plainly when no passage matches", async () => {
    const memo = await attachDocument(session, "annual.md", report);
    expect(await run(await toolFor([memo]), { name: "annual.md", query: "zirconium refinery" })).toContain(
      "No passage in this document",
    );
  });

  it("gives a worksheet its schema, a slice of rows and the id that loads it", async () => {
    const book = await attachDocument(session, "holdings.csv", csv);
    const ledger = await ledgerWith([book]);
    const text = await run(await toolFor([book], ledger), { name: "holdings.csv", part: "Sheet" });

    expect(text).toMatch(/^holdings\.csv — .+ · Sheet\n/);
    expect(text).toContain("Columns: date (date), ticker (text), shares (number)");
    expect(text).toContain("Loaded as evidence U1. Pass it to financial_calculator.");
    expect(text).toContain("| 2026-01-02 | NVDA | 400 |");
  });

  it("marks its result as an attachment, so the numbers in it become matchable", async () => {
    const memo = await attachDocument(session, "annual.md", report);
    const result = await (await toolFor([memo])).execute("call-1", { name: "annual.md" } as never, new AbortController().signal);

    expect(result.details).toMatchObject({ source: { id: "attachment", name: "attachment annual.md", tier: 4 }, read: "head" });
  });

  it("refuses a name it does not have, and says what it does have", async () => {
    const memo = await attachDocument(session, "annual.md", report);
    await expect(run(await toolFor([memo]), { name: "ghost.docx" })).rejects.toThrow(/Attached to this chat: annual.md/);
  });

  it("refuses a part that is not there, and lists the ones that are", async () => {
    const book = await attachDocument(session, "holdings.csv", csv);
    await expect(run(await toolFor([book]), { name: "holdings.csv", part: 4 })).rejects.toThrow(/Its parts are: 1\. Sheet/);
  });

  it("says so when the file behind a descriptor has gone", async () => {
    const ghost: StoredAttachment = {
      attachment: `${"f".repeat(40)}.md`,
      name: "gone.md",
      kind: "document",
      bytes: 10,
      tokens: 3,
      parts: 1,
    };
    await expect(run(await toolFor([ghost]), { name: "gone.md" })).rejects.toThrow(/no longer readable/);
  });
});

describe("findDocument and findPart", () => {
  const memo: StoredAttachment = {
    attachment: `${"a".repeat(40)}.docx`,
    name: "Q3 memo.docx",
    kind: "document",
    bytes: 10,
    tokens: 3,
    parts: 2,
  };

  it("takes the file name the conversation shows, whatever its case, or the stored name", () => {
    expect(findDocument([memo], "q3 MEMO.docx")).toBe(memo);
    expect(findDocument([memo], memo.attachment)).toBe(memo);
    expect(findDocument([memo], "Q3 memo")).toBe(memo);
    expect(findDocument([memo], "other.docx")).toBeUndefined();
  });

  it("takes a part by number or by the name it carries", () => {
    const parsed = {
      version: 1 as const,
      kind: "document" as const,
      parts: [
        { type: "text" as const, label: "Page 1", markdown: "first" },
        { type: "text" as const, label: "Page 2", markdown: "second" },
      ],
      outline: [],
      warnings: [],
    };
    expect(findPart(parsed, 2)?.index).toBe(1);
    expect(findPart(parsed, "2")?.index).toBe(1);
    expect(findPart(parsed, "page 1")?.index).toBe(0);
    expect(findPart(parsed, 9)).toBeUndefined();
  });
});
