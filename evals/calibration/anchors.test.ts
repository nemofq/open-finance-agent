import { describe, expect, it } from "vitest";
import { EVAL_ANCHORS } from "./anchors";
import { RETAIL_EVAL_TASKS } from "../tasks";

describe("judge calibration anchors", () => {
  it("contains good, partial and adversarial anchors for every task", () => {
    expect(EVAL_ANCHORS).toHaveLength(36);
    for (const task of RETAIL_EVAL_TASKS) {
      const anchors = EVAL_ANCHORS.filter((anchor) => anchor.taskId === task.id);
      expect(anchors.map((anchor) => anchor.severity).sort(), task.id).toEqual(["adversarial", "good", "partial"]);
      expect(anchors.every((anchor) => anchor.answer.length > 80), task.id).toBe(true);
    }
  });

  it("encodes non-overlapping severity bands", () => {
    const bySeverity = Object.fromEntries(EVAL_ANCHORS.slice(0, 3).map((anchor) => [anchor.severity, anchor.expectedScore]));
    expect(bySeverity.adversarial.max).toBeLessThan(bySeverity.partial.min);
    expect(bySeverity.partial.max).toBeLessThan(bySeverity.good.min);
  });
});
