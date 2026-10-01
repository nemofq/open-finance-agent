import { describe, expect, it } from "vitest";
import { EVIDENCE_CONTRACT, normalizeSourceUrl } from "./coverage-contract";
import { validateEvidenceContract } from "./coverage";
import { loadDataset } from "./dataset";
import { RETAIL_EVAL_TASKS } from "../tasks";
import type { EvalEvidenceRequirement, EvalTask } from "../types";

describe("versioned dataset evidence contracts", () => {
  it("state each task's cutoff and intraday time exactly as the task definitions do", () => {
    const declared = Object.fromEntries(RETAIL_EVAL_TASKS.map((task) => [task.id, { cutoff: task.asOfDate, asOfTime: task.asOfTime }]));
    const contracted = Object.fromEntries(Object.entries(EVIDENCE_CONTRACT.tasks)
      .map(([id, contract]) => [id, { cutoff: contract.cutoff, asOfTime: contract.asOfTime }]));

    expect(contracted).toEqual(declared);
  });

  it("preflights all twelve tasks, and every scored evidence requirement, against their captured as-of evidence", () => {
    const db = loadDataset();

    expect(validateEvidenceContract(db, RETAIL_EVAL_TASKS)).toEqual([]);
  });

  it("maps every critical rubric item to corpus records covered before the task cutoff", () => {
    for (const task of RETAIL_EVAL_TASKS) {
      const contract = EVIDENCE_CONTRACT.tasks[task.id];
      const labels = new Set((contract.requiredEvidence ?? []).map((requirement) => requirement.label));
      for (const item of task.rubricItems.filter((candidate) => candidate.critical)) {
        expect(item.coverage, `${task.id}/${item.id}`).toBeDefined();
        for (const label of item.coverage?.requiredEvidenceLabels ?? []) {
          expect(labels.has(label), `${task.id}/${item.id}: ${label}`).toBe(true);
        }
        for (const ticker of item.coverage?.alphaEarningsTickers ?? []) {
          expect(contract.alpha?.earnings.includes(ticker), `${task.id}/${item.id}: Alpha earnings ${ticker}`).toBe(true);
        }
      }
    }
  });

  it("fails a single-task preflight when the contract's task set is stale", () => {
    const db = loadDataset();
    const task = RETAIL_EVAL_TASKS[0];
    const staleId = "retail-99-removed-task";
    const stale = "evidence contract task set does not match the active benchmark task set";

    expect(validateEvidenceContract(db, [task])).toEqual([]);
    EVIDENCE_CONTRACT.tasks[staleId] = EVIDENCE_CONTRACT.tasks[task.id];
    try {
      expect(validateEvidenceContract(db, [task])).toContain(stale);
    } finally {
      delete EVIDENCE_CONTRACT.tasks[staleId];
    }
  });

  it("uses the dated June 5 announcement instead of the July-created 19a notices", () => {
    const db = loadDataset();
    const task = RETAIL_EVAL_TASKS.find((candidate) => candidate.id === "retail-04-dividend-yield-trap");
    expect(task).toBeDefined();
    if (!task) return;
    const contract = EVIDENCE_CONTRACT.tasks[task.id];
    const announcement = contract.documents?.find((document) => document.kind === "distribution_announcement");

    expect(announcement?.url).toContain("/2024/06/05/");
    expect(contract.documents?.some((document) => document.url.includes("19a-1%20Notice%20%28Payable%20Date%206_7_24%29"))).toBe(false);
    expect(db.documents.some((document) => document.canonicalUrl.includes("19a-1%20Notice%20%28Payable%20Date%206_7_24%29"))).toBe(false);
  });

  it("fails preflight when a required document is deleted or its body is damaged", () => {
    const db = loadDataset();
    const task = RETAIL_EVAL_TASKS.find((candidate) => candidate.id === "retail-10-smci-accounting-red-flag");
    expect(task).toBeDefined();
    if (!task) return;
    const required = EVIDENCE_CONTRACT.tasks[task.id].documents?.find((document) => document.kind === "filing_body");
    expect(required).toBeDefined();
    if (!required) return;
    const normalized = normalizeSourceUrl(required.url);
    const damaged = {
      ...db,
      documents: db.documents.map((document) => [document.canonicalUrl, ...document.urlAliases].some((url) => {
        try { return normalizeSourceUrl(url) === normalized; } catch { return false; }
      }) ? { ...document, body: "" } : document),
    };

    expect(validateEvidenceContract(damaged, [task]).some((issue) => issue.includes("no readable official body"))).toBe(true);
  });

  it("fails preflight for each missing official retail-04 source, if it is removed", () => {
    const db = loadDataset();
    const task = RETAIL_EVAL_TASKS.find((candidate) => candidate.id === "retail-04-dividend-yield-trap");
    expect(task).toBeDefined();
    if (!task) return;

    for (const required of EVIDENCE_CONTRACT.tasks[task.id].documents ?? []) {
      const normalized = normalizeSourceUrl(required.url);
      const removed = {
        ...db,
        documents: db.documents.filter((document) => ![document.canonicalUrl, ...document.urlAliases].some((url) => {
          try { return normalizeSourceUrl(url) === normalized; } catch { return false; }
        })),
      };
      expect(validateEvidenceContract(removed, [task]).some((issue) => issue.includes(`required ${required.kind} is not present`))).toBe(true);
    }
  });

  describe("scored evidence requirements", () => {
    const sources = (task: EvalTask) => task.requiredEvidence.flatMap((requirement) => (requirement.kind === "source" ? [requirement] : []));
    const byId = (id: string) => {
      const task = RETAIL_EVAL_TASKS.find((candidate) => candidate.id === id);
      if (!task) throw new Error(`No task ${id}`);
      return task;
    };

    /** Validate one task with its contract requirements swapped, restoring them afterwards. */
    function issuesWith(id: string, requirements: EvalEvidenceRequirement[], task = byId(id), db = loadDataset()): string[] {
      const contract = EVIDENCE_CONTRACT.tasks[id];
      const original = contract.requiredEvidence;
      contract.requiredEvidence = requirements;
      try {
        return validateEvidenceContract(db, [task]);
      } finally {
        contract.requiredEvidence = original;
      }
    }

    it("rejects a fact no served statement can satisfy by the cutoff", () => {
      const id = "retail-13-semis-figure-survival";
      const base = { kind: "fact", ticker: "AMD", statement: "key_metrics", metric: "revenue", label: "AMD revenue", points: 15 } as const;

      expect(issuesWith(id, [{ ...base, period: "2024-09-28" }])).toEqual([]);
      // The next quarter was filed after the task's cutoff.
      expect(issuesWith(id, [{ ...base, period: "2024-12-28" }]).some((issue) => issue.includes("cannot be satisfied"))).toBe(true);
      // Compiled but never served by edgar_financials, so no answer could earn it.
      expect(issuesWith(id, [{ ...base, metric: "inventory" }]).some((issue) => issue.includes("has no financialStatements entry"))).toBe(true);
    });

    it("pins INTC quarterly free cash flow to the latest quarter the statement code serves", () => {
      const id = "retail-05-intel-value-trap";
      const base = { kind: "fact", ticker: "INTC", statement: "cashflow", metric: "freeCashFlow", label: "INTC FCF", points: 15 } as const;

      // The Q2 10-Q reports six-month cash flows; the statement code derives the Q2 quarter from
      // year-to-date facts, so Q2 2024 is served by the cutoff alongside Q1.
      expect(issuesWith(id, [{ ...base, period: "2024-06-29" }])).toEqual([]);
      expect(issuesWith(id, [{ ...base, period: "2024-03-30" }])).toEqual([]);
      // Q3 2024 was filed after the task's cutoff, so a requirement pinned to it could never be earned.
      expect(issuesWith(id, [{ ...base, period: "2024-09-28" }]).some((issue) => issue.includes("cannot be satisfied"))).toBe(true);
    });

    it("accepts a fact from the key-metrics view for the statement that carries it, but not one that does not", () => {
      const id = "retail-13-semis-figure-survival";
      const base = { kind: "fact", ticker: "AMD", metric: "revenue", label: "AMD revenue", points: 15 } as const;

      expect(issuesWith(id, [{ ...base, statement: "income" }])).toEqual([]);
      // Revenue is no balance-sheet line, so no view can serve it as one.
      expect(issuesWith(id, [{ ...base, statement: "balance" }]).some((issue) => issue.includes("the balance statement has no revenue line"))).toBe(true);
    });

    it("requires a contract market record for a ticker-bound quote and seeded holdings for a holdings read", () => {
      expect(issuesWith("retail-14-apple-pre-open-timing", [{ kind: "ledger", source: "quote", ticker: "AAPL", label: "AAPL close", points: 15 }])).toEqual([]);
      expect(issuesWith("retail-14-apple-pre-open-timing", [{ kind: "ledger", source: "quote", ticker: "MSFT", label: "MSFT close", points: 15 }])
        .some((issue) => issue.includes("needs a dated market record for MSFT"))).toBe(true);
      // Requirements name the outcome, not a tool route.
      const routed = { kind: "ledger", tool: "market_quotes", ticker: "AAPL", label: "AAPL close", points: 15 } as unknown as EvalEvidenceRequirement;
      expect(issuesWith("retail-14-apple-pre-open-timing", [routed]).some((issue) => issue.includes("names unsupported source"))).toBe(true);

      const id = "retail-12-concentration-profile-fit";
      const holdings = [{ kind: "ledger", source: "holdings", label: "Holdings", points: 15 }] as const;
      expect(issuesWith(id, [...holdings])).toEqual([]);
      expect(issuesWith(id, [...holdings], { ...byId(id), holdings: [] }).some((issue) => issue.includes("needs seeded holdings"))).toBe(true);
    });

    it("rejects weights that do not total the 15 tool points", () => {
      const requirements = byId("retail-14-apple-pre-open-timing").requiredEvidence;
      const light = requirements.map((requirement, index) => (index === 0 ? { ...requirement, points: requirement.points - 1 } : requirement));

      expect(issuesWith("retail-14-apple-pre-open-timing", light).some((issue) => issue.includes("weights total 14"))).toBe(true);
    });

    it("rejects a scored source URL the mock would report under a different canonical URL", () => {
      // Reads and fetches report the canonical URL, so scoring an alias could never be met.
      const id = "retail-01-nvda-beat-and-drop";
      const release = sources(byId(id))[0]?.urls[0] ?? "";
      const db = loadDataset();
      const moved = {
        ...db,
        documents: db.documents.map((document) => document.canonicalUrl === release
          ? { ...document, canonicalUrl: release.replace("q2fy25pr.htm", "q2fy25pr-copy.htm"), urlAliases: [release] }
          : document),
      };
      const scored: EvalEvidenceRequirement[] = [{ kind: "source", urls: [release], label: "NVIDIA release", points: 15 }];

      expect(issuesWith(id, scored)).toEqual([]);
      expect(issuesWith(id, scored, byId(id), moved).some((issue) => issue.includes("is an alias"))).toBe(true);
    });
  });

  it("rejects task scopes compiled against an older contract hash", () => {
    const db = loadDataset();
    const task = RETAIL_EVAL_TASKS[0];
    const changed = { ...db, scopes: { ...db.scopes, [task.id]: { ...db.scopes[task.id], contractHash: "old-contract" } } };

    expect(validateEvidenceContract(changed, [task]).some((issue) => issue.includes("different evidence contract"))).toBe(true);
  });
});
