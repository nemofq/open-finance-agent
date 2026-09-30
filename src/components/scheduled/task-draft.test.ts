import { describe, expect, it } from "vitest";
import type { ScheduledSchedule, ScheduledTask } from "@/lib/scheduled/types";
import { blankDraft, draftFromTask, draftProblem, scheduleFromDraft, type TaskDraft, taskInputFromDraft, tomorrowOnTheHour } from "./task-draft";

const model = { provider: "lab", model: "qwen3" };
const CHAT = "00000000-0000-4000-8000-000000000001";

function taskWith(schedule: ScheduledSchedule, overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: "00000000-0000-4000-8000-00000000000a",
    title: "Morning check",
    prompt: "Check AAPL",
    destination: { type: "chat", sessionId: CHAT },
    schedule,
    status: "active",
    nextRunAt: null,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    ...overrides,
  };
}

const ready = (draft: Partial<TaskDraft>): TaskDraft => ({ ...blankDraft({ timeZone: "UTC", model, sessionId: CHAT }), title: "T", prompt: "P", ...draft });

describe("task drafts", () => {
  it("starts tomorrow on the hour, continuing the chat it was opened from", () => {
    const now = new Date(2026, 3, 1, 9, 41);
    expect(tomorrowOnTheHour(now)).toBe("2026-04-02T09:00");
    expect(blankDraft({ timeZone: "UTC", model, sessionId: CHAT, now })).toMatchObject({ destination: "chat", sessionId: CHAT, repeat: "once", when: "2026-04-02T09:00" });
    expect(blankDraft({ timeZone: "UTC", model: null, now }).destination).toBe("standalone");
  });

  it("saves back the schedule it was opened with", () => {
    const schedules: ScheduledSchedule[] = [
      { kind: "once", runAt: "2026-04-02T08:00:00.000Z", timeZone: "Europe/London" },
      { kind: "recurring", dtStartLocal: "2026-04-06T09:00", timeZone: "America/New_York", rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE" },
      { kind: "recurring", dtStartLocal: "2026-04-06T09:00", timeZone: "UTC", rrule: "FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=15" },
      { kind: "recurring", dtStartLocal: "2026-04-06T09:00", timeZone: "UTC", rrule: "FREQ=MINUTELY;INTERVAL=30" },
    ];
    for (const schedule of schedules) expect(scheduleFromDraft(draftFromTask(taskWith(schedule), model))).toEqual(schedule);
  });

  it("shows a one-time run at its own zone's wall clock", () => {
    const draft = draftFromTask(taskWith({ kind: "once", runAt: "2026-07-01T08:00:00.000Z", timeZone: "Europe/London" }), model);
    expect(draft).toMatchObject({ repeat: "once", when: "2026-07-01T09:00", timeZone: "Europe/London" });
  });

  it("keeps a rule a preset cannot express as its raw RRULE", () => {
    const schedule: ScheduledSchedule = { kind: "recurring", dtStartLocal: "2026-04-06T09:00", timeZone: "UTC", rrule: "FREQ=DAILY;COUNT=5" };
    const draft = draftFromTask(taskWith(schedule), model);
    expect(draft).toMatchObject({ repeat: "advanced", rrule: "FREQ=DAILY;COUNT=5" });
    expect(scheduleFromDraft(draft)).toEqual(schedule);
  });

  it("runs monthly on the first run's day unless a day is given", () => {
    expect(scheduleFromDraft(ready({ repeat: "monthly", when: "2026-04-06T09:00" }))).toMatchObject({ rrule: "FREQ=MONTHLY;INTERVAL=1" });
    expect(scheduleFromDraft(ready({ repeat: "monthly", when: "2026-04-06T09:00", dayOfMonth: "20" }))).toMatchObject({ rrule: "FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=20" });
  });

  it("says what is missing before anything is sent", () => {
    expect(draftProblem(ready({}))).toBeNull();
    expect(draftProblem(ready({ title: " " }))).toBe("Title and instructions are required.");
    expect(draftProblem(ready({ sessionId: "" }))).toBe("Choose the chat to continue.");
    expect(draftProblem(ready({ destination: "standalone", model: null }))).toBe("Choose a model for a new chat per run.");
    expect(draftProblem(ready({ repeat: "daily", interval: "0" }))).toBe("The interval must be a whole number of 1 or more.");
    expect(draftProblem(ready({ repeat: "daily", interval: "1.5" }))).toBe("The interval must be a whole number of 1 or more.");
    expect(draftProblem(ready({ repeat: "monthly", dayOfMonth: "32" }))).toBe("The day of the month must be between 1 and 31.");
    expect(draftProblem(ready({ repeat: "advanced", rrule: "" }))).toBe("Enter an RRULE.");
  });

  it("sends the destination the draft chose, and a skill only when one is named", () => {
    const toChat = taskInputFromDraft(ready({ title: " Brief ", skill: " " }));
    expect(toChat).toMatchObject({ title: "Brief", destination: { type: "chat", sessionId: CHAT } });
    expect(toChat).not.toHaveProperty("skill");
    const standalone = taskInputFromDraft(ready({ destination: "standalone", skill: "stock-brief" }));
    expect(standalone).toMatchObject({ skill: "stock-brief", destination: { type: "standalone", model } });
  });
});
