"use client";

import { useState } from "react";
import { CheckboxGroup, Field, StatusLine } from "@/components/shared/field-row";
import { patchJson, postJson } from "@/components/shared/http-client";
import { ModelPicker } from "@/components/shared/model-picker";
import { PendingButton } from "@/components/shared/pending-button";
import { notifyScheduledChanged } from "@/components/shared/session-events";
import { useLlmModels } from "@/components/shared/use-llm-models";
import { Button } from "@/components/ui/button";
import { DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { ScheduledTask } from "@/lib/scheduled/types";
import type { SessionHeader } from "@/lib/sessions/types";
import { errorMessage } from "@/lib/utils";
import {
  blankDraft,
  draftFromTask,
  draftProblem,
  REPEAT_OPTIONS,
  type Repeat,
  type TaskDraft,
  taskInputFromDraft,
  WEEKDAY_NAMES,
} from "./task-draft";

export interface TaskEditorProps {
  /** The task to edit, or `null` to create one. */
  task: ScheduledTask | null;
  /** The chats a task may continue, when the editor offers a choice of chat. */
  sessions: SessionHeader[];
  /**
   * Opened from a chat: a new task continues that chat, and the only other choice is a new chat per
   * run, so no list of chats is offered.
   */
  fromChatId?: string;
  onClose: () => void;
}

/**
 * The one scheduled-task form, for the Scheduled page and a chat's Schedule button. It renders the
 * dialog's content, so the caller owns the `Dialog`, and remounts it (a new `key`) per opening,
 * since the draft is seeded at mount. A saved task is announced with `notifyScheduledChanged`.
 */
export function TaskEditor({ task, sessions, fromChatId, onClose }: TaskEditorProps) {
  const models = useLlmModels();
  const [draft, setDraft] = useState<TaskDraft>(() =>
    task
      ? draftFromTask(task, null)
      : blankDraft({
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          // Left empty, a new-chat-per-run task uses the default model, which may still be loading.
          model: null,
          sessionId: fromChatId ?? sessions.find((session) => session.messageCount > 0)?.id,
        }),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const defaultModel = models.data?.defaultModel ?? null;
  const model = draft.model ?? defaultModel;
  const set = <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const chats = sessions.filter((session) => session.messageCount > 0);
  const recurring = draft.repeat !== "once";

  async function submit() {
    const ready = { ...draft, model };
    const problem = draftProblem(ready);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const input = taskInputFromDraft(ready);
      if (task) await patchJson<unknown>(`/api/scheduled-tasks/${encodeURIComponent(task.id)}`, input);
      else await postJson<unknown>("/api/scheduled-tasks", input);
      notifyScheduledChanged();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogContent className="max-h-[min(92vh,48rem)] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{task ? "Edit scheduled task" : fromChatId ? "Schedule this chat" : "New scheduled task"}</DialogTitle>
        <DialogDescription>
          Runs unattended with the tools and API keys enabled at the time. The server must be running.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-3">
        <Field label="Title">
          {(id) => <Input id={id} value={draft.title} placeholder="Morning check" onChange={(event) => set("title", event.target.value)} />}
        </Field>
        <Field label="Instructions for every run">
          {(id) => (
            <Textarea
              id={id}
              rows={5}
              value={draft.prompt}
              placeholder="What should happen each time, and when to stop"
              onChange={(event) => set("prompt", event.target.value)}
            />
          )}
        </Field>
        <Field label="Skill (optional)">
          {(id) => <Input id={id} value={draft.skill} placeholder="earnings-preview" onChange={(event) => set("skill", event.target.value)} />}
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Destination">
            {(id) => (
              <NativeSelect
                id={id}
                value={draft.destination}
                onChange={(event) => set("destination", event.target.value as TaskDraft["destination"])}
              >
                <option value="chat">{fromChatId ? "Continue this chat" : "Continue an existing chat"}</option>
                <option value="standalone">Create a new chat per run</option>
              </NativeSelect>
            )}
          </Field>
          {draft.destination === "standalone" ? (
            // The picker's trigger is a button with its own text, so it is named directly.
            <div className="space-y-1.5">
              <p className="text-sm leading-none font-medium">Model</p>
              <ModelPicker
                aria-label="Model for each run"
                providers={models.data?.providers ?? []}
                value={model}
                onChange={(value) => set("model", value)}
                defaultModel={defaultModel}
                loading={models.loading}
                placeholder="Choose a model"
              />
            </div>
          ) : fromChatId === undefined ? (
            <Field label="Chat">
              {(id) => (
                <NativeSelect id={id} value={draft.sessionId} onChange={(event) => set("sessionId", event.target.value)}>
                  {draft.sessionId === "" ? <option value="">Choose a chat</option> : null}
                  {draft.sessionId !== "" && !chats.some((session) => session.id === draft.sessionId) ? (
                    <option value={draft.sessionId}>A chat no longer listed</option>
                  ) : null}
                  {chats.map((session) => (
                    <option key={session.id} value={session.id}>
                      {session.title}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Repeats">
            {(id) => (
              <NativeSelect id={id} value={draft.repeat} onChange={(event) => set("repeat", event.target.value as Repeat)}>
                {REPEAT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label="Time zone (IANA)">
            {(id) => <Input id={id} value={draft.timeZone} onChange={(event) => set("timeZone", event.target.value)} />}
          </Field>
          <Field label={recurring ? "First run (local time)" : "Runs at (local time)"}>
            {(id) => <Input id={id} type="datetime-local" value={draft.when} onChange={(event) => set("when", event.target.value)} />}
          </Field>
          {recurring && draft.repeat !== "advanced" ? (
            <Field label={draft.repeat === "minutes" ? "Every how many minutes" : "Interval"}>
              {(id) => (
                <Input id={id} type="number" min={1} value={draft.interval} onChange={(event) => set("interval", event.target.value)} />
              )}
            </Field>
          ) : null}
          {draft.repeat === "monthly" ? (
            <Field label="Day of the month">
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={1}
                  max={31}
                  value={draft.dayOfMonth}
                  placeholder="Same as the first run"
                  onChange={(event) => set("dayOfMonth", event.target.value)}
                />
              )}
            </Field>
          ) : null}
        </div>

        {draft.repeat === "weekly" ? (
          <CheckboxGroup
            legend="Days (none: the first run's weekday)"
            options={WEEKDAY_NAMES.map((label, value) => ({ value, label }))}
            value={draft.weekdays}
            onChange={(weekdays) => set("weekdays", weekdays)}
          />
        ) : null}
        {draft.repeat === "advanced" ? (
          <Field label="RRULE">
            {(id) => (
              <Textarea
                id={id}
                rows={2}
                className="font-mono"
                value={draft.rrule}
                placeholder="FREQ=DAILY;INTERVAL=1"
                onChange={(event) => set("rrule", event.target.value)}
              />
            )}
          </Field>
        ) : null}

        {error ? <StatusLine ok={false}>{error}</StatusLine> : null}
      </div>

      <DialogFooter>
        <Button variant="outline" disabled={saving} onClick={onClose}>
          Cancel
        </Button>
        <PendingButton pending={saving} onClick={() => void submit()}>
          {task ? "Save changes" : "Create task"}
        </PendingButton>
      </DialogFooter>
    </DialogContent>
  );
}
