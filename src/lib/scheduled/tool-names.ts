/**
 * The scheduled-task tools' names, in a module with no imports so the browser can match a tool
 * card against them without bundling the tools themselves. Renaming one breaks saved chats' cards.
 */
export const SCHEDULED_TOOL_NAMES = {
  create: "scheduled_task_create",
  update: "scheduled_task_update",
  delete: "scheduled_task_delete",
  pauseSelf: "scheduled_task_pause_self",
} as const;
