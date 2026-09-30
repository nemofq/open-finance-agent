import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { attachDocument } from "@/lib/attachments/testing";
import { createLedger } from "@/lib/evidence/ledger";
import type { EvidenceEntry } from "@/lib/evidence/types";
import { replayEvidence } from "@/lib/harness/evidence";
import { createSession } from "@/lib/sessions/store";
import { analyseEvidence } from "./evidence";

let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-eval-evidence-"));
  vi.stubEnv("OFA_HOME", home);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

it("rebuilds a user message's attached document and figures with the ids the app gives them", async () => {
  const session = await createSession({ model: { provider: "lab", model: "qwen3" } });
  const memo = await attachDocument(session.id, "memo.md", "# Q3\n\nRevenue rose 12%.");
  const filing: EvidenceEntry = { id: "E1", kind: "E", summary: "EDGAR 8-K, $NVDA", fetchedAt: "2026-01-01T00:00:00Z" };
  const messages: AgentMessage[] = [
    { role: "user", content: [{ type: "text", text: "Margins fell 3.5%. Why, given my memo?" }], documents: [memo], timestamp: 0 },
    { role: "toolResult", toolCallId: "call-1", toolName: "edgar_filings", content: [{ type: "text", text: "8-K" }], isError: false, timestamp: 1, details: { evidence: filing } },
  ];

  const analysis = await analyseEvidence({
    sessionId: session.id,
    dataDir: home,
    messages,
    reported: [filing],
    finalText: "Revenue rose 12% while margins fell 3.5%.",
  });

  const app = createLedger({ sessionId: session.id, dataDir: home, messages });
  await replayEvidence(session.id, app, messages);
  const userEntries = (entries: EvidenceEntry[]) => entries.filter((entry) => entry.kind === "U").map((entry) => [entry.id, entry.summary]);
  expect(userEntries(analysis.entries)).toEqual(userEntries(app.list("U")));
  expect(analysis.entries.find((entry) => entry.id === "U1")?.summary).toContain("memo.md");
  const revenue = analysis.figureMatches.find((match) => match.figure.value === 12);
  expect(revenue?.matches).toContain("U1");
});
