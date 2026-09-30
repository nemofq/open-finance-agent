import type { ModelRef } from "@/lib/config/schema";
import { type PresetKind, presetFromSchedule, scheduleFromPreset } from "@/lib/scheduled/schedule";
import type { TaskInput } from "@/lib/scheduled/schema";
import type { ScheduledSchedule, ScheduledTask } from "@/lib/scheduled/types";
import { instantAt, wallClock } from "@/lib/time/zone";

/**
 * The task editor's form state and its translation to and from a task. Every field is kept as
 * typed so an edit never reformats what the user is typing; `scheduleFromDraft` reads it once, on
 * save. A recurring rule a preset cannot express stays "advanced", as its raw RRULE.
 */

export type Repeat = "once" | PresetKind | "advanced";

export interface TaskDraft {
  title: string;
  prompt: string;
  skill: string;
  destination: "chat" | "standalone";
  /** The chat a "chat" destination continues. */
  sessionId: string;
  /** The model a "standalone" run starts its chat with. */
  model: ModelRef | null;
  repeat: Repeat;
  /** `YYYY-MM-DDTHH:mm` in `timeZone`: when a one-time task runs, or a recurring one first runs. */
  when: string;
  interval: string;
  weekdays: number[];
  /** Empty: the day of the month of the first run. */
  dayOfMonth: string;
  rrule: string;
  timeZone: string;
}

export const REPEAT_OPTIONS: { value: Repeat; label: string }[] = [
  { value: "once", label: "Once" },
  { value: "minutes", label: "Every N minutes" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "advanced", label: "Advanced RRULE" },
];

/** Short names for the weekday checkboxes, indexed like `Date.getDay()` and `WEEKDAY_CODES`. */
export const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const pad = (value: number) => String(value).padStart(2, "0");

/** The top of the hour a day after `now`, as a `datetime-local` value in the browser's zone. */
export function tomorrowOnTheHour(now: Date): string {
  const date = new Date(now.getTime() + 86_400_000);
  date.setMinutes(0, 0, 0);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function blankDraft({
  timeZone,
  model,
  sessionId = "",
  now = new Date(),
}: {
  timeZone: string;
  model: ModelRef | null;
  /** A chat to continue; without one the task starts a new chat per run. */
  sessionId?: string;
  now?: Date;
}): TaskDraft {
  return {
    title: "",
    prompt: "",
    skill: "",
    destination: sessionId ? "chat" : "standalone",
    sessionId,
    model,
    repeat: "once",
    when: tomorrowOnTheHour(now),
    interval: "1",
    weekdays: [],
    dayOfMonth: "",
    rrule: "FREQ=DAILY",
    timeZone,
  };
}

/** The editor's fields for an existing task. `defaultModel` fills the picker of a chat task. */
export function draftFromTask(task: ScheduledTask, defaultModel: ModelRef | null): TaskDraft {
  const common = {
    title: task.title,
    prompt: task.prompt,
    skill: task.skill ?? "",
    destination: task.destination.type,
    sessionId: task.destination.type === "chat" ? task.destination.sessionId : "",
    model: task.destination.type === "standalone" ? task.destination.model : defaultModel,
    interval: "1",
    weekdays: [],
    dayOfMonth: "",
    rrule: "FREQ=DAILY",
    timeZone: task.schedule.timeZone,
  };
  const schedule = task.schedule;
  if (schedule.kind === "once") {
    const clock = wallClock(new Date(schedule.runAt), schedule.timeZone);
    return { ...common, repeat: "once", when: `${clock.date}T${clock.time}` };
  }
  const preset = presetFromSchedule(schedule);
  if (!preset) return { ...common, repeat: "advanced", when: schedule.dtStartLocal, rrule: schedule.rrule };
  return {
    ...common,
    repeat: preset.kind,
    when: schedule.dtStartLocal,
    interval: String(preset.interval ?? 1),
    weekdays: preset.weekdays ?? [],
    dayOfMonth: preset.dayOfMonth === undefined ? "" : String(preset.dayOfMonth),
    rrule: schedule.rrule,
  };
}

const WHOLE = /^\d+$/;

/**
 * Why the draft cannot be saved yet, or `null`. Only what the form alone can tell: the server
 * checks the rule, the zone and that a one-time run is in the future.
 */
export function draftProblem(draft: TaskDraft): string | null {
  if (!draft.title.trim() || !draft.prompt.trim()) return "Title and instructions are required.";
  if (draft.destination === "chat" && !draft.sessionId) return "Choose the chat to continue.";
  if (draft.destination === "standalone" && !draft.model) return "Choose a model for a new chat per run.";
  if (!draft.when) return "Choose when it runs.";
  if (draft.repeat !== "once" && draft.repeat !== "advanced" && (!WHOLE.test(draft.interval.trim()) || Number(draft.interval) < 1)) {
    return "The interval must be a whole number of 1 or more.";
  }
  const day = draft.dayOfMonth.trim();
  if (draft.repeat === "monthly" && day && (!WHOLE.test(day) || Number(day) < 1 || Number(day) > 31)) {
    return "The day of the month must be between 1 and 31.";
  }
  if (draft.repeat === "advanced" && !draft.rrule.trim()) return "Enter an RRULE.";
  return null;
}

/**
 * The schedule the draft describes. Assumes `draftProblem` found nothing; throws a readable
 * `RangeError` for a date or zone that does not exist.
 */
export function scheduleFromDraft(draft: TaskDraft): ScheduledSchedule {
  if (draft.repeat === "once") {
    // `when` is a wall-clock time in the task's zone, as a recurring start is, and as the editor
    // showed it; reading it in the browser's zone would move a task saved from another zone.
    const [date = "", time = ""] = draft.when.split("T");
    return { kind: "once", runAt: instantAt(date, time, draft.timeZone).toISOString(), timeZone: draft.timeZone };
  }
  if (draft.repeat === "advanced") return { kind: "recurring", dtStartLocal: draft.when, timeZone: draft.timeZone, rrule: draft.rrule.trim() };
  const day = draft.dayOfMonth.trim();
  return scheduleFromPreset({
    kind: draft.repeat,
    interval: Number(draft.interval),
    dtStartLocal: draft.when,
    timeZone: draft.timeZone,
    weekdays: draft.repeat === "weekly" ? draft.weekdays : undefined,
    dayOfMonth: draft.repeat === "monthly" && day ? Number(day) : undefined,
  });
}

/** The body the create and update routes take. Assumes `draftProblem` found nothing. */
export function taskInputFromDraft(draft: TaskDraft): TaskInput {
  const skill = draft.skill.trim();
  return {
    title: draft.title.trim(),
    prompt: draft.prompt.trim(),
    ...(skill ? { skill } : {}),
    destination:
      draft.destination === "chat" || !draft.model
        ? { type: "chat", sessionId: draft.sessionId }
        : { type: "standalone", model: draft.model },
    schedule: scheduleFromDraft(draft),
  };
}
