import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLedger } from "@/lib/evidence/ledger";
import { registerUserMessages } from "@/lib/evidence/user";
import type { EvidenceLedger } from "@/lib/evidence/types";
import { resolveEvidence } from "@/lib/calculator/evidence";
import { ATTACHMENT_SOURCE, registerAttachment, tableIdsFor } from "./evidence";
import { readParsed } from "./documents";
import { attachDocument } from "./testing";
import type { ParsedAttachment, StoredAttachment } from "./types";

let home: string;
let session: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-attach-evidence-"));
  process.env.OFA_HOME = home;
  session = randomUUID();
});

afterEach(() => {
  delete process.env.OFA_HOME;
  rmSync(home, { recursive: true, force: true });
});

const ledgerFor = (messages?: AgentMessage[]): EvidenceLedger =>
  createLedger({ sessionId: session, dataDir: home, messages });

const csv = (rows: number): string =>
  ["date,ticker,shares", ...Array.from({ length: rows }, (_, i) => `2026-01-${String((i % 28) + 1).padStart(2, "0")},NVDA,${100 + i}`)].join("\n");

const memo = "# Q3 memo\n\nRevenue rose to $30,040M and the gross margin was 75.1%.";

async function attach(name: string, bytes: string): Promise<{ document: StoredAttachment; parsed: ParsedAttachment }> {
  const document = await attachDocument(session, name, bytes);
  const parsed = await readParsed(session, document.attachment);
  if (!parsed) throw new Error("the parse was not written");
  return { document, parsed };
}

/** A user message carrying documents, as the transcript holds one. */
const withDocuments = (text: string, documents: StoredAttachment[]): AgentMessage => ({
  role: "user",
  content: [{ type: "text", text }],
  documents,
  timestamp: 1,
});

describe("registerAttachment", () => {
  it("registers a worksheet as a U entry the calculator can load", async () => {
    const { document, parsed } = await attach("holdings.csv", csv(5));
    const ledger = ledgerFor();
    const [entry] = registerAttachment(ledger, document, parsed);

    expect(entry).toMatchObject({ kind: "U", origin: "attachment", source: ATTACHMENT_SOURCE });
    expect(entry.summary).toBe("holdings.csv › Sheet (5 rows)");
    expect(entry.table?.columns).toEqual(["date", "ticker", "shares"]);
    expect(entry.attachment).toEqual({ file: document.attachment, part: 0 });
  });

  it("is a user's figure, never a provider's: tier 4, below every data connection", () => {
    expect(ATTACHMENT_SOURCE.tier).toBe(4);
  });

  it("puts a table too large to carry inline in the payload the calculator falls back to", async () => {
    const { document, parsed } = await attach("holdings.csv", csv(250));
    const ledger = ledgerFor();
    const [entry] = registerAttachment(ledger, document, parsed);
    await ledger.flush();

    expect(entry.table).toBeUndefined();
    expect(entry.hasPayload).toBe(true);
    const resolved = await resolveEvidence(ledger, [entry.id]);
    expect(resolved[entry.id].columns).toEqual(["date", "ticker", "shares"]);
    expect(resolved[entry.id].rows).toHaveLength(250);
    expect(resolved[entry.id].meta.summary).toContain("holdings.csv");
  });

  it("writes that payload once, however often the transcript is replayed", async () => {
    const { document, parsed } = await attach("holdings.csv", csv(250));
    const first = ledgerFor();
    registerAttachment(first, document, parsed);
    await first.flush();

    const second = ledgerFor();
    const [entry] = registerAttachment(second, document, parsed);
    await second.flush();
    // The id is the same, so the second turn found the payload already written and kept it.
    expect(entry.hasPayload).toBe(true);
    expect((await second.loadPayload<{ table: { rows: unknown[] } }>(entry.id))?.table.rows).toHaveLength(250);
  });

  it("registers a document's prose as one entry holding the numbers in it", async () => {
    const { document, parsed } = await attach("memo.md", memo);
    const ledger = ledgerFor();
    const [entry] = registerAttachment(ledger, document, parsed);

    expect(entry.summary).toBe("memo.md (attached document, 1 section)");
    expect(entry.attachment).toEqual({ file: document.attachment });
    expect(entry.numbers?.map((number) => number.value)).toEqual(expect.arrayContaining([30_040_000_000, 75.1]));
    // Which is the point: a figure the answer quotes off the file is sourced, not invented.
    expect(ledger.matchValue({ raw: "75.1%", value: 75.1, unit: "%", index: 0 })).toEqual([entry.id]);
  });

  it("does nothing for a file whose parse has gone", async () => {
    const { document } = await attach("memo.md", memo);
    expect(registerAttachment(ledgerFor(), document, null)).toEqual([]);
  });
});

describe("tableIdsFor", () => {
  it("names a file's worksheets by part, which is how a digest names them", async () => {
    const sheet = await attach("holdings.csv", csv(3));
    const prose = await attach("memo.md", memo);
    const ledger = ledgerFor();
    registerAttachment(ledger, sheet.document, sheet.parsed);
    registerAttachment(ledger, prose.document, prose.parsed);

    expect(tableIdsFor(ledger, sheet.document.attachment)(0)).toBe("U1");
    expect(tableIdsFor(ledger, prose.document.attachment)(0)).toBeUndefined();
  });
});

describe("id stability across turns", () => {
  it("replays a transcript to the same ids when a message has been appended", async () => {
    const sheet = await attach("holdings.csv", csv(4));
    const prose = await attach("memo.md", memo);
    const parses = new Map([
      [sheet.document.attachment, sheet.parsed],
      [prose.document.attachment, prose.parsed],
    ]);
    const replay = (ledger: EvidenceLedger, messages: AgentMessage[]) =>
      registerUserMessages(ledger, messages, {
        documents: (document) => registerAttachment(ledger, document, parses.get(document.attachment)),
      });

    const first: AgentMessage[] = [withDocuments("I hold 400 shares; here is the book.", [sheet.document])];
    const before = replay(ledgerFor(), first);

    const later = [...first, withDocuments("and the memo, at $118.20", [prose.document])];
    const after = replay(ledgerFor(later), later);

    // The file's entries come before the figures of the message that carried it, and the entries
    // of an earlier turn keep the ids they were given.
    expect(before.map((entry) => entry.id)).toEqual(["U1", "U2"]);
    expect(before.map((entry) => entry.summary)).toEqual(after.slice(0, 2).map((entry) => entry.summary));
    expect(after.map((entry) => entry.id)).toEqual(["U1", "U2", "U3", "U4"]);
    expect(after[2].summary).toBe("memo.md (attached document, 1 section)");
    expect(after[3]).toMatchObject({ value: 118.2, origin: "message" });
  });

  it("registers a skill turn's documents too, at the position they were attached", async () => {
    const { document, parsed } = await attach("memo.md", memo);
    const ledger = ledgerFor();
    const created = registerUserMessages(
      ledger,
      [{ role: "skill", skill: "earnings-review", request: "", prompt: "Run it.", documents: [document], timestamp: 1 }],
      { documents: (attached) => registerAttachment(ledger, attached, parsed) },
    );
    expect(created.map((entry) => entry.id)).toEqual(["U1"]);
  });
});
