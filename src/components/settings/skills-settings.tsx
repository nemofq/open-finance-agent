"use client";

import { useState } from "react";
import {
  PencilLineIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Disclosure } from "@/components/shared/disclosure";
import { deleteJson } from "@/components/shared/http-client";
import { EmptyState, SettingsHeader } from "@/components/shared/page-shell";
import { StatusLine } from "@/components/shared/field-row";
import { useDialogSubject } from "@/components/shared/use-dialog-subject";
import { useJson } from "@/components/shared/use-json";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { errorMessage } from "@/lib/utils";
import type { Skill } from "@/lib/skills/skill";
import { SkillForm, type SkillFormInitial } from "./skill-form";

interface SkillsResponse {
  skills?: Skill[];
  userSkillsDir?: string;
}

function SkillCard({
  skill,
  onEdit,
  onCustomise,
  onDelete,
}: {
  skill: Skill;
  onEdit: () => void;
  onCustomise: () => void;
  onDelete: () => void;
}) {
  const owned = skill.source === "user";

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 font-mono text-sm">
          {skill.name}
          {skill.source ? <Badge variant="outline">{skill.source}</Badge> : null}
          {skill.disableModelInvocation ? <Badge variant="secondary">hidden from model</Badge> : null}
        </CardTitle>
        {skill.description ? <CardDescription>{skill.description}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        <Disclosure
          className="space-y-2"
          triggerClassName={buttonVariants({ variant: "ghost", size: "sm" })}
          summary={(open) => (
            <>
              {open ? "Hide" : "View"} instructions<span className="sr-only"> for {skill.name}</span>
            </>
          )}
        >
          <pre className="max-h-96 overflow-auto rounded-lg bg-muted/50 p-3 text-xs whitespace-pre-wrap">
            {skill.body ?? "This skill's body was not included in the response."}
          </pre>
        </Disclosure>
      </CardContent>
      <CardFooter className="flex-wrap gap-2">
        {owned ? (
          <>
            <Button variant="ghost" size="sm" aria-label={`Edit ${skill.name}`} onClick={onEdit}>
              <PencilIcon />
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              aria-label={`Delete ${skill.name}`}
              onClick={onDelete}
            >
              <Trash2Icon />
              Delete
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" aria-label={`Customise ${skill.name}`} onClick={onCustomise}>
            <PencilLineIcon />
            Customise
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

/** Settings › Skills: the bundled and user skills, with a form to add, edit or customise one. */
export function SkillsSettings() {
  const { data, error, reload } = useJson<SkillsResponse>("/api/skills");
  const editing = useDialogSubject<SkillFormInitial>();
  const [pendingDelete, setPendingDelete] = useState<Skill | null>(null);
  const [deleting, setDeleting] = useState(false);

  const skills = data?.skills ?? [];

  const draftFrom = (skill: Skill, mode: "create" | "edit"): SkillFormInitial => ({
    name: skill.name,
    description: skill.description ?? "",
    body: skill.body ?? "",
    disableModelInvocation: skill.disableModelInvocation,
    mode,
  });

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteJson(`/api/skills/${encodeURIComponent(pendingDelete.name)}`);
      setPendingDelete(null);
      await reload();
      toast.success(`${pendingDelete.name} deleted`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <SettingsHeader
        title="Skills"
        description="Reusable analysis playbooks the agent can run, shipped with the app or added by you."
        action={
          data ? (
            <Button variant="outline" onClick={() => editing.show()}>
              <PlusIcon />
              Add skill
            </Button>
          ) : null
        }
      />

      {error ? <StatusLine ok={false}>{error}</StatusLine> : null}

      {!data && !error ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : skills.length === 0 ? (
        <EmptyState>No skills found.</EmptyState>
      ) : (
        <div className="space-y-3">
          {skills.map((skill) => (
            <SkillCard
              key={skill.name}
              skill={skill}
              onEdit={() => editing.show(draftFrom(skill, "edit"))}
              onCustomise={() => editing.show(draftFrom(skill, "create"))}
              onDelete={() => setPendingDelete(skill)}
            />
          ))}
        </div>
      )}

      {data?.userSkillsDir ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Skills you add here are saved to{" "}
          <code className="font-mono">{data.userSkillsDir}/&lt;name&gt;/SKILL.md</code>; you can also drop
          files there by hand.
        </p>
      ) : null}

      <SkillForm
        key={editing.key}
        open={editing.open}
        initial={editing.subject}
        onOpenChange={editing.onOpenChange}
        onSaved={(skill) => {
          void reload();
          toast.success(`${skill.name} ${editing.subject?.mode === "edit" ? "saved" : "added"}`);
        }}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete “${pendingDelete?.name ?? "skill"}”?`}
        description="Its SKILL.md file is removed from your skills folder. A bundled skill of the same name takes over again."
        confirmLabel="Delete"
        pending={deleting}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
