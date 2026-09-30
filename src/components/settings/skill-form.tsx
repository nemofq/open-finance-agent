"use client";

import { useId, useState } from "react";
import { postJson, putJson } from "@/components/shared/http-client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldHelp, StatusLine } from "@/components/shared/field-row";
import { FormDialog } from "@/components/shared/form-dialog";
import { useUnsavedChangesWarning } from "@/components/shared/use-unsaved-changes";
import { MAX_DESCRIPTION_CHARS, NAME_RE, type Skill } from "@/lib/skills/skill";
import { errorMessage } from "@/lib/utils";

/** Only worth showing the counter once the limit is in sight. */
const COUNTER_FROM = MAX_DESCRIPTION_CHARS - 128;

const INSTRUCTIONS_PLACEHOLDER = `## Purpose
What this skill produces and when it applies.

## Process
1. Pull the numbers you need.
2. Work through them in this order.

## Output
The shape the final answer should take.`;

export interface SkillFormInitial {
  name: string;
  description: string;
  body: string;
  disableModelInvocation?: boolean;
  /** "edit" updates the user skill in place; "create" writes a new file, prefilled or blank. */
  mode: "create" | "edit";
}

export interface SkillFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omitted when adding from scratch; prefilled in edit and "customise a bundled skill" mode. */
  initial?: SkillFormInitial;
  onSaved: (skill: Skill) => void;
}

/**
 * Add/edit dialog for one user skill, which owns its own POST/PUT. The draft is seeded from
 * `initial` at mount, so the caller must remount this component (change its `key`) on each open.
 */
export function SkillForm({ open, onOpenChange, initial, onSaved }: SkillFormProps) {
  const descriptionId = useId();
  const hiddenId = useId();

  const editing = initial?.mode === "edit";
  const copying = initial !== undefined && !editing;

  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [hidden, setHidden] = useState(initial?.disableModelInvocation ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const nameOk = NAME_RE.test(trimmedName);
  const descriptionOk = trimmedDescription !== "" && trimmedDescription.length <= MAX_DESCRIPTION_CHARS;
  const valid = (editing || nameOk) && descriptionOk && body.trim() !== "";
  const changed =
    name !== (initial?.name ?? "") ||
    description !== (initial?.description ?? "") ||
    body !== (initial?.body ?? "") ||
    hidden !== (initial?.disableModelInvocation ?? false);
  // The modal blocks in-app links, so this guards closing or reloading the tab and the New chat shortcut.
  useUnsavedChangesWarning(open && changed);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        description: trimmedDescription,
        body,
        disableModelInvocation: hidden,
      };
      const res = editing
        ? await putJson<{ skill: Skill }>(`/api/skills/${encodeURIComponent(trimmedName)}`, payload)
        : await postJson<{ skill: Skill }>("/api/skills", { name: trimmedName, ...payload });
      onSaved(res.skill);
      onOpenChange(false);
    } catch (err) {
      // Validation and conflict messages come back ready to read, so show them verbatim.
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit skill" : copying ? "Customise skill" : "Add skill"}
      description={
        copying
          ? "Adding it creates a copy in your skills folder that overrides the bundled one."
          : "A skill is a playbook the agent can follow. It is saved as a SKILL.md in your skills folder."
      }
      className="overflow-hidden sm:max-w-2xl"
      submitLabel={editing ? "Save skill" : "Add skill"}
      submitting={saving}
      canSubmit={valid}
      onSubmit={() => void save()}
    >
      {/* The two text fields scroll inside their fixed heights; the outer cap only matters on very
          short screens. The error stays inside it, so it cannot push the buttons off the dialog. */}
      <div className="-m-1 max-h-[calc(85vh-12rem)] space-y-4 overflow-y-auto p-1">
        <Field label="Name">
          {(id) => (
            <>
              <Input
                id={id}
                value={name}
                disabled={editing}
                spellCheck={false}
                placeholder="earnings-recap"
                className="font-mono"
                onChange={(event) => setName(event.target.value)}
              />
              <FieldHelp
                help={
                  editing
                    ? "The folder name on disk. Rename by deleting this skill and adding it again."
                    : "Lowercase letters, digits and hyphens, up to 64 characters. Also the /command that runs it."
                }
              />
              {!editing && trimmedName !== "" && !nameOk ? (
                <StatusLine ok={false}>Use 1–64 lowercase letters, digits or hyphens.</StatusLine>
              ) : null}
            </>
          )}
        </Field>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor={descriptionId}>Description</Label>
            {description.length > COUNTER_FROM ? (
              <span
                className={
                  description.length > MAX_DESCRIPTION_CHARS
                    ? "text-xs text-destructive"
                    : "text-xs text-muted-foreground"
                }
              >
                {description.length}/{MAX_DESCRIPTION_CHARS}
              </span>
            ) : null}
          </div>
          <Textarea
            id={descriptionId}
            value={description}
            className="h-20 resize-none overflow-y-auto field-sizing-fixed"
            placeholder="Summarise a company's latest quarter against consensus and the prior year."
            onChange={(event) => setDescription(event.target.value)}
          />
          <FieldHelp help="Used by the model to decide when the skill applies, so say what it does and when to reach for it." />
        </div>

        <Field
          label="Instructions"
          help="Markdown in the agentskills.io format: Purpose, Process, Output. Pasting a whole SKILL.md works too — its frontmatter is stripped."
        >
          {(id) => (
            <Textarea
              id={id}
              value={body}
              spellCheck={false}
              placeholder={INSTRUCTIONS_PLACEHOLDER}
              className="h-80 max-h-[45vh] resize-none overflow-y-auto font-mono text-xs field-sizing-fixed"
              onChange={(event) => setBody(event.target.value)}
            />
          )}
        </Field>

        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor={hiddenId}>Hide from the model</Label>
            <FieldHelp help="Still runnable from the composer with /name; the model will not pick it on its own." />
          </div>
          <Switch id={hiddenId} checked={hidden} onCheckedChange={setHidden} />
        </div>

        {error ? <StatusLine ok={false}>{error}</StatusLine> : null}
      </div>
    </FormDialog>
  );
}
