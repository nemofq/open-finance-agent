import { mkdtempSync, rmSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { JsonValue } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractFigures } from "./figures";
import { evidenceOf } from "./ids";
import { createLedger } from "./ledger";
import { payloadPath } from "./store";
import type { EvidenceEntry } from "./types";

let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-evidence-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const ledgerFor = (messages?: AgentMessage[]) => createLedger({ sessionId: "chat-1", dataDir: home, messages });

function toolResult(details: JsonValue): AgentMessage {
  return {
    role: "toolResult",
    toolCallId: "call-1",
    toolName: "edgar_financials",
    content: [{ type: "text", text: "…" }],
    details,
    isError: false,
    timestamp: 1,
  };
}

const entry = (id: string, extra: Partial<EvidenceEntry> = {}): EvidenceEntry => ({
  id,
  kind: id[0] as EvidenceEntry["kind"],
  summary: `entry ${id}`,
  fetchedAt: "2026-09-01T00:00:00.000Z",
  ...extra,
});

describe("ids and ordering", () => {
  it("numbers each kind on its own counter and lists in id order", () => {
    const ledger = ledgerFor();
    ledger.add({ kind: "E", summary: "first" });
    ledger.add({ kind: "C", summary: "computed" });
    const third = ledger.add({ kind: "E", summary: "second" });

    expect(third.id).toBe("E2");
    expect(ledger.list().map((item) => item.id)).toEqual(["E1", "E2", "C1"]);
    expect(ledger.list("C").map((item) => item.id)).toEqual(["C1"]);
    expect(ledger.get("E2")?.summary).toBe("second");
  });

  it("stamps fetchedAt when the caller does not", () => {
    expect(Date.parse(ledgerFor().add({ kind: "A", summary: "wacc" }).fetchedAt)).not.toBeNaN();
  });
});

describe("rebuilding from a transcript", () => {
  const messages: AgentMessage[] = [
    toolResult({ statement: "income", evidence: entry("E1", { facts: [{ metric: "revenue", period: "2024-07-28", value: 30_040_000_000, unit: "USD" }] }) }),
    toolResult({ evidence: [entry("E2"), entry("C1")] }),
    toolResult({ url: "https://example.com" }),
  ];

  it("restores every entry with its own id", () => {
    const ledger = ledgerFor(messages);
    expect(ledger.list().map((item) => item.id)).toEqual(["E1", "E2", "C1"]);
    expect(ledger.get("E1")?.facts?.[0].value).toBe(30_040_000_000);
  });

  it("continues the counters instead of reusing an id", () => {
    const ledger = ledgerFor(messages);
    expect(ledger.add({ kind: "E", summary: "new" }).id).toBe("E3");
    expect(ledger.add({ kind: "C", summary: "new" }).id).toBe("C2");
    expect(ledger.add({ kind: "U", summary: "new" }).id).toBe("U1");
  });

  it("reads evidence off details in either shape, and ignores anything else", () => {
    expect(evidenceOf({ evidence: entry("E1") })).toHaveLength(1);
    expect(evidenceOf({ evidence: [entry("E1"), entry("E2")] })).toHaveLength(2);
    expect(evidenceOf({ evidence: { id: "nope", kind: "E" } })).toEqual([]);
    expect(evidenceOf({ statement: "income" })).toEqual([]);
    expect(evidenceOf(undefined)).toEqual([]);
    expect(evidenceOf("text")).toEqual([]);
  });
});

describe("payloads", () => {
  it("writes one file per entry, readable only by the user", async () => {
    const ledger = ledgerFor();
    const created = ledger.add({ kind: "E", summary: "filing" });
    await ledger.savePayload(created.id, { content: [{ type: "text", text: "10-Q body" }] });
    await ledger.flush();

    const file = payloadPath(home, "chat-1", created.id);
    expect(file).toBe(path.join(home, "sessions", "chat-1", "evidence", "E1.json"));
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({ content: [{ text: "10-Q body" }] });
    expect(await ledger.loadPayload("E1")).toMatchObject({ content: [{ text: "10-Q body" }] });
    expect(ledger.get("E1")?.hasPayload).toBe(true);
  });

  it("returns undefined for an entry with no payload, and refuses a bad id", async () => {
    const ledger = ledgerFor();
    expect(await ledger.loadPayload("E9")).toBeUndefined();
    await expect(ledger.savePayload("../../etc/passwd", {})).rejects.toThrow(/evidence id/);
  });
});

describe("queries", () => {
  const stocked = () => {
    const ledger = ledgerFor();
    ledger.add({
      kind: "E",
      summary: "EDGAR",
      entity: { ticker: "NVDA", cik: "0001045810" },
      fetchedAt: "2026-09-01T00:00:00.000Z",
      facts: [
        { metric: "revenue", period: "2024-07-28", value: 30_040_000_000, unit: "USD" },
        { metric: "netIncome", period: "2024-07-28", value: 16_599_000_000, unit: "USD" },
      ],
    });
    ledger.add({
      kind: "E",
      summary: "Alpha Vantage",
      entity: { ticker: "NVDA" },
      fetchedAt: "2026-09-02T00:00:00.000Z",
      facts: [{ metric: "totalRevenue", period: "2024-07-28", value: 30_040_000_000, unit: "USD" }],
    });
    ledger.add({ kind: "C", summary: "gross margin", name: "gross margin", value: 75.1, unit: "%" });
    ledger.add({
      kind: "E",
      summary: "prices",
      entity: { ticker: "AAPL" },
      table: { columns: ["date", "close"], rows: [["2024-08-28", 226.49]], index: "date" },
    });
    return ledger;
  };

  it("finds facts by entity, alias and period, newest first", () => {
    const ledger = stocked();
    const hits = ledger.findFacts({ entity: { ticker: "nvda" }, metric: "sales", period: "2024-07-28" });
    expect(hits.map((hit) => hit.entry.id)).toEqual(["E2", "E1"]);
    expect(ledger.findFacts({ entity: { cik: "1045810" } }).map((hit) => hit.fact.metric)).toEqual([
      "revenue",
      "netIncome",
    ]);
    expect(ledger.findFacts({ entity: { ticker: "MSFT" } })).toEqual([]);
  });

  it("matches a figure against facts, single values and table cells", () => {
    const ledger = stocked();
    const [revenue] = extractFigures("$30,040M");
    expect(ledger.matchValue(revenue)).toEqual(["E1", "E2"]);

    const [margin] = extractFigures("75.1%");
    expect(ledger.matchValue(margin)).toEqual(["C1"]);

    const [close] = extractFigures("$226.49");
    expect(ledger.matchValue(close)).toEqual(["E3"]);

    const [invented] = extractFigures("$41,200M");
    expect(ledger.matchValue(invented)).toEqual([]);
  });
});

describe("without a data folder", () => {
  it("keeps payloads in memory and hands back a copy, as a read from disk would", async () => {
    const ledger = createLedger({ sessionId: "chat-1" });
    const created = ledger.add({ kind: "E", summary: "quote" });
    const payload = { rows: [[1, 2]] };
    await ledger.savePayload(created.id, payload);
    payload.rows.push([3, 4]);

    expect(created.hasPayload).toBe(true);
    expect(await ledger.loadPayload(created.id)).toEqual({ rows: [[1, 2]] });
    expect(await ledger.loadPayload("E9")).toBeUndefined();
  });

  it("refuses an id that is not an evidence id, as the disk store does", async () => {
    await expect(createLedger({ sessionId: "chat-1" }).savePayload("../x" as EvidenceEntry["id"], {})).rejects.toThrow("not an evidence id");
  });
});
