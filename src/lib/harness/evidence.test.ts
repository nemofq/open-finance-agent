import { describe, expect, it } from "vitest";
import { createLedger } from "@/lib/evidence/ledger";
import { confirmedCompanies, evidence } from "./evidence";
import { testTurn } from "./testing";

describe("the SEC filers a chat identified", () => {
  it("names each filer once, by its latest entry, with its CIK and newest former name", () => {
    const ledger = createLedger({ sessionId: "s" });
    ledger.add({ kind: "E", summary: "QVC profile", entity: { cik: "0001254699", name: "QVC Group, Inc." } });
    ledger.add({ kind: "E", summary: "Old QVC profile", entity: { ticker: "QVCGA", cik: "0001355096", name: "Old QVC Group, Inc.",
      formerNames: ["Qurate Retail, Inc. (until 2025-02-24)", "Liberty Interactive Corp (until 2018-04-09)"] } });
    ledger.add({ kind: "E", summary: "QVC filings", entity: { cik: "0001254699", name: "QVC Group, Inc." } });
    ledger.add({ kind: "E", summary: "A quote", entity: { ticker: "AAPL" } });
    expect(confirmedCompanies(ledger)).toBe("SEC filers identified in this chat: "
      + "$QVCGA = Old QVC Group, Inc. (CIK 0001355096; formerly Qurate Retail, Inc. (until 2025-02-24)); "
      + "no listed ticker = QVC Group, Inc. (CIK 0001254699). "
      + "Reuse these rather than looking them up again, and pass the CIK for a filer with no listed ticker.");
  });

  it("adds nothing to the turn note before any filer was identified", () => {
    const turn = testTurn();
    turn.ledger.add({ kind: "E", summary: "A quote", entity: { ticker: "AAPL" } });
    expect(confirmedCompanies(turn.ledger)).toBeUndefined();
    expect(evidence.turnNote?.(turn)).toBeUndefined();
  });

  it("joins the filers to the user's own inputs in one note", () => {
    const turn = testTurn();
    turn.ledger.add({ kind: "U", summary: "cost basis $120", value: 120 });
    turn.ledger.add({ kind: "E", summary: "Apple profile", entity: { ticker: "AAPL", cik: "0000320193", name: "Apple Inc." } });
    expect(evidence.turnNote?.(turn)?.split("\n")).toEqual([
      expect.stringMatching(/^Recent user-provided inputs/), expect.stringMatching(/^SEC filers identified in this chat: \$AAPL = Apple Inc\./)]);
  });
});
