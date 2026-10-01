import { describe, expect, it } from "vitest";
import { loadSkills } from "@/lib/skills/loader";
import { profileInputSchema } from "@/lib/profile/schema";
import { templateIds } from "@/lib/reports/templates";
import { isTradingDay } from "@/lib/time/calendar";
import { profilePromptFor } from "./harness/seed";
import { offlineTimeContext, taskTimeContext } from "./harness/task-time";
import { RETAIL_EVAL_TASKS } from "./tasks";
import type { EvalTask } from "./types";

/**
 * The four harness task types carry data the runner acts on before the turn: a skill
 * name, a profile, a holdings ledger, follow-up prompts and a wall-clock time. These assertions hold
 * that data to what the runner and the modules behind it will accept.
 */

const byId = (id: string): EvalTask => {
  const task = RETAIL_EVAL_TASKS.find((candidate) => candidate.id === id);
  if (!task) throw new Error(`No task ${id}`);
  return task;
};

describe("the task suite", () => {
  it("keeps every id unique", () => {
    expect(new Set(RETAIL_EVAL_TASKS.map((task) => task.id)).size).toBe(RETAIL_EVAL_TASKS.length);
  });

  it("gives the four harness task types one task each", () => {
    const categories = RETAIL_EVAL_TASKS.map((task) => task.category);
    for (const category of ["report_delivery", "profile_fit", "figure_survival", "pre_open_timing"]) {
      expect(categories.filter((candidate) => candidate === category)).toHaveLength(1);
    }
  });
});

describe("the report-delivery task", () => {
  const task = byId("retail-11-nike-earnings-review-report");

  it("names a bundled skill that produces a real report template", async () => {
    const skill = (await loadSkills()).find((candidate) => candidate.name === task.skill);
    expect(skill, `${task.skill} is bundled`).toBeDefined();
    expect(templateIds()).toContain(skill?.metadata?.output);
  });

  it("scores the release it reports on, which the report itself may cite", () => {
    expect(task.requiredEvidence.some((requirement) =>
      requirement.kind === "source" && requirement.urls.some((url) => url.endsWith("/q4fy24exhibit991er.htm")))).toBe(true);
  });
});

describe("the profile-aware task", () => {
  const task = byId("retail-12-concentration-profile-fit");

  it("declares a profile the store will accept", () => {
    expect(profileInputSchema.safeParse(task.profile).success).toBe(true);
  });

  it("declares holdings the ledger can open, each with an account and a currency", () => {
    expect(task.holdings?.length).toBeGreaterThan(1);
    for (const position of task.holdings ?? []) {
      expect(position.accountId).toBeTruthy();
      expect(position.currency).toMatch(/^[A-Z]{3}$/);
      expect(position.quantity).toBeGreaterThan(0);
      // `addManualPosition` needs one of the two, or it throws before the turn starts.
      expect(position.totalCost ?? position.averagePrice).toBeGreaterThan(0);
    }
  });

  it("reads the holdings through the tool rather than the prompt", () => {
    expect(task.requiredEvidence.some((requirement) => requirement.kind === "ledger" && requirement.source === "holdings")).toBe(true);
    expect(task.prompt).not.toMatch(/\d/);
  });

  it("requires a dated quote for every held position, since weights cannot be computed without one", () => {
    const quoted = task.requiredEvidence.flatMap((requirement) =>
      requirement.kind === "ledger" && requirement.source === "quote" && requirement.ticker ? [requirement.ticker] : []);
    expect(quoted.sort()).toEqual((task.holdings ?? []).map((position) => position.symbol).sort());
  });
});

describe("the figure-survival task", () => {
  const task = byId("retail-13-semis-figure-survival");

  it("asks a second question whose answer is the one graded", () => {
    expect(task.followUpPrompts).toHaveLength(1);
    expect(task.followUpPrompts?.[0].length).toBeGreaterThan(20);
  });

  it("makes the first turn data-heavy and requires exact evidence recovery", () => {
    expect(task.expectedEntities.length).toBeGreaterThanOrEqual(3);
    expect(task.prompt).toMatch(/eight quarters/i);
    // The graded turn must still carry the exact latest-quarter facts pulled in the first turn.
    const pinned = task.requiredEvidence.filter((requirement) => requirement.kind === "fact" && requirement.period === "2024-09-28");
    expect(pinned?.map((requirement) => requirement.kind === "fact" && requirement.ticker)).toEqual(["AMD", "INTC"]);
  });
});

describe("the task cohort", () => {
  it("contains exactly the compact 2024 task set", () => {
    expect(RETAIL_EVAL_TASKS).toHaveLength(12);
    expect(RETAIL_EVAL_TASKS.every((task) => task.asOfDate.startsWith("2024-"))).toBe(true);
  });

  it("keeps evidence-contract raw weights at 15 before v2 normalizes them onto 6 points", () => {
    for (const task of RETAIL_EVAL_TASKS) {
      expect(task.requiredEvidence.length, task.id).toBeGreaterThan(0);
      expect(task.requiredEvidence.reduce((total, requirement) => total + requirement.points, 0), task.id).toBe(15);
    }
  });

  it("defines an 80-point semantic rubric, critical gates and 8 contract points for every task", () => {
    for (const task of RETAIL_EVAL_TASKS) {
      expect(task.rubricItems.reduce((total, item) => total + item.weight, 0), task.id).toBe(80);
      expect(task.rubricItems.some((item) => item.critical), task.id).toBe(true);
      expect(new Set(task.rubricItems.map((item) => item.id)).size, task.id).toBe(task.rubricItems.length);
      expect(task.contracts.reduce((total, contract) => total + contract.points, 0), task.id).toBe(8);
    }
  });

  it("keeps every declared profile valid", () => {
    for (const task of RETAIL_EVAL_TASKS) {
      if (task.profile) expect(profileInputSchema.safeParse(task.profile).success, task.id).toBe(true);
    }
  });

  it("freezes the profile text of every task that declares a profile, in a file that exists", () => {
    for (const task of RETAIL_EVAL_TASKS) {
      // A profile without frozen text would leave its prompt to the app's current rendering.
      expect(Boolean(task.profilePrompt), task.id).toBe(Boolean(task.profile));
      if (task.profilePrompt) expect(profilePromptFor(task), task.id).toMatch(/^## Investor profile/);
    }
  });
});

describe("the pre-open task", () => {
  const task = byId("retail-14-apple-pre-open-timing");

  it("is asked before the open on a real trading day", () => {
    expect(task.asOfTime).toMatch(/^\d{2}:\d{2}$/);
    expect(isTradingDay(task.asOfDate)).toBe(true);
  });

  it("falls inside eastern daylight time, which is how the runner reads the clock", () => {
    const month = Number(task.asOfDate.slice(5, 7));
    expect(month).toBeGreaterThanOrEqual(4);
    expect(month).toBeLessThanOrEqual(10);
  });

  it("runs the turn live at that moment, so the market state is real and there is no as-of cutoff", () => {
    const time = taskTimeContext(task);
    expect(time.mode).toBe("live");
    expect(time.asOf).toBeUndefined();
    expect(time.localDate).toBe(task.asOfDate);
    expect(time.localTime).toBe(task.asOfTime);
    expect(time.market.session).not.toBe("open");
  });

  it("pins the same instant when the offline dataset is selected", () => {
    const time = offlineTimeContext(task);
    expect(time.mode).toBe("fixed");
    expect(time.asOf).toBe(task.asOfDate);
    expect(time.localTime).toBe(task.asOfTime);
    expect(time.market.session).toBe("pre_market");
    expect(time.market.lastCompletedSession).toBe("2024-10-30");
  });
});

describe("every other task", () => {
  it("stays pinned to the end of its as-of day", () => {
    for (const task of RETAIL_EVAL_TASKS.filter((candidate) => !candidate.asOfTime)) {
      const time = taskTimeContext(task);
      expect(time.mode, task.id).toBe("fixed");
      expect(time.asOf, task.id).toBe(task.asOfDate);
    }
  });
});
