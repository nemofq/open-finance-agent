import { type Static, Type } from "typebox";

/**
 * The scheduled-task contract, defined once: what a task runs on, where its answers go, and what a
 * user or the agent may send to create or edit one. The TypeScript types derive from it, the
 * `scheduled_task_*` tools build their parameters from it, and the routes validate bodies with it.
 * The agent's tools add their own descriptions, which are model input; nothing here is.
 */

/** When a task runs: once at an instant, or on an RRULE from a local wall-clock start. */
export const scheduleSchema = Type.Union([
  Type.Object({ kind: Type.Literal("once"), runAt: Type.String(), timeZone: Type.String() }),
  Type.Object({ kind: Type.Literal("recurring"), dtStartLocal: Type.String(), timeZone: Type.String(), rrule: Type.String() }),
]);

/** Where a run's answer goes: an existing chat, or a new chat per run on a fixed model. */
export const destinationSchema = Type.Union([
  Type.Object({ type: Type.Literal("chat"), sessionId: Type.String() }),
  Type.Object({ type: Type.Literal("standalone"), model: Type.Object({ provider: Type.String(), model: Type.String() }) }),
]);

/** The statuses a user or the agent may set; `completed` is the runner's alone. */
const settableStatusSchema = Type.Union([Type.Literal("active"), Type.Literal("paused")]);

/** A new task. */
export const taskInputSchema = Type.Object({
  title: Type.String(),
  prompt: Type.String(),
  skill: Type.Optional(Type.String()),
  destination: destinationSchema,
  schedule: scheduleSchema,
});

/** An edit; run bookkeeping (`nextRunAt`, `lastRun*`) is the runner's and not part of it. */
export const taskPatchSchema = Type.Object({
  title: Type.Optional(Type.String()),
  prompt: Type.Optional(Type.String()),
  skill: Type.Optional(Type.String()),
  status: Type.Optional(settableStatusSchema),
  destination: Type.Optional(destinationSchema),
  schedule: Type.Optional(scheduleSchema),
});

export type ScheduleInput = Static<typeof scheduleSchema>;
export type DestinationInput = Static<typeof destinationSchema>;
export type TaskInput = Static<typeof taskInputSchema>;
export type TaskPatch = Static<typeof taskPatchSchema>;
