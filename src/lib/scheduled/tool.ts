import { Type } from "typebox";
import { humanSchedule } from "@/lib/scheduled/schedule";
import { destinationSchema, scheduleSchema, taskPatchSchema } from "@/lib/scheduled/schema";
import { createTask, deleteTask, updateTask } from "@/lib/scheduled/tasks";
import { SCHEDULED_TOOL_NAMES } from "@/lib/scheduled/tool-names";
import type { FinanceTool, Module, ModuleContext } from "@/lib/tools/contracts";

// A refusal from the task service (a missing chat, a model that does not resolve, a run still in
// progress) is thrown as it stands, so the model reads the service's own sentence as the error.

// The task contract (./schema) with the model's wording. A destination is optional here: the tool
// defaults it to the current chat.
const createParameters = Type.Object({
  title: Type.String({ description: "Short title shown in Scheduled." }),
  prompt: Type.String({ description: "Durable instructions to run each time." }),
  skill: Type.Optional(Type.String({ description: "Optional exact skill name, such as earnings-preview." })),
  destination: Type.Optional(destinationSchema),
  schedule: scheduleSchema,
});

const updateParameters = Type.Object({ taskId: Type.String(), ...taskPatchSchema.properties });

const taskIdParameters = Type.Object({ taskId: Type.String() });

function result(text: string, details?: unknown) {
  return { content: [{ type: "text" as const, text }], details: details ?? {} };
}

function defaultDestination(ctx: ModuleContext) {
  return { type: "chat" as const, sessionId: ctx.session.id };
}

function createTool(ctx: ModuleContext): FinanceTool<typeof createParameters> {
  return {
    name: SCHEDULED_TOOL_NAMES.create,
    label: "Create scheduled task",
    description: "Create a recurring or one-time background task. The prompt must say what to do on every run and when to stop or ask the user for input. If destination is omitted, the current chat is continued.",
    parameters: createParameters,
    meta: { class: "general", effect: "write-local" },
    async execute(_id, params) {
      const task = await createTask({ ...params, destination: params.destination ?? defaultDestination(ctx) });
      return result(`Scheduled “${task.title}” for ${humanSchedule(task.schedule)}. Next run: ${task.nextRunAt ?? "none"}.`, task);
    },
  };
}

function updateTool(): FinanceTool<typeof updateParameters> {
  return {
    name: SCHEDULED_TOOL_NAMES.update,
    label: "Update scheduled task",
    description: "Update a scheduled task's prompt, schedule, title or active/paused status. Use the exact task id from a prior confirmation.",
    parameters: updateParameters,
    meta: { class: "general", effect: "write-local" },
    async execute(_id, params) {
      const { taskId, ...patch } = params;
      const task = await updateTask(taskId, patch);
      if (!task) return result(`No scheduled task with id ${taskId}.`);
      return result(`Updated “${task.title}”. Next run: ${task.nextRunAt ?? "none"}.`, task);
    },
  };
}

function deleteTool(): FinanceTool<typeof taskIdParameters> {
  return {
    name: SCHEDULED_TOOL_NAMES.delete,
    label: "Delete scheduled task",
    description: "Delete a scheduled task. It does not delete chats or reports. Do not use this unless the user explicitly asks to delete the task.",
    parameters: taskIdParameters,
    meta: { class: "general", effect: "write-local" },
    async execute(_id, params) {
      const deleted = await deleteTask(params.taskId);
      return result(deleted ? `Deleted scheduled task ${params.taskId}; its chats and reports remain.` : `No scheduled task with id ${params.taskId}.`);
    },
  };
}

function pauseSelfTool(ctx: ModuleContext): FinanceTool<typeof taskIdParameters> {
  return {
    name: SCHEDULED_TOOL_NAMES.pauseSelf,
    label: "Pause current scheduled task",
    description: "Pause the scheduled task that is running this turn when its durable instructions say it should stop.",
    parameters: taskIdParameters,
    meta: { class: "general", effect: "write-local" },
    async execute(_id, params) {
      if (!ctx.turn?.taskId || params.taskId !== ctx.turn.taskId) return result("A scheduled run may pause only its own task.");
      const task = await updateTask(params.taskId, { status: "paused" });
      return result(task ? `Paused “${task.title}”.` : `No scheduled task with id ${params.taskId}.`);
    },
  };
}

export const scheduledModule: Module = {
  id: "scheduled",
  name: "Scheduled tasks",
  kind: "tool",
  description: "Create and manage background scheduled tasks that return to a chat or start standalone chats.",
  settings: [],
  defaultConfig: { enabled: true },
  async createTools(_cfg, ctx) {
    if (ctx.turn?.kind === "scheduled") return [pauseSelfTool(ctx)];
    return [createTool(ctx), updateTool(), deleteTool()];
  },
};
