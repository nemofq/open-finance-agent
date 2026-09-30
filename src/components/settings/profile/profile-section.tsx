"use client";

import { useState } from "react";
import { SaveButton, SectionHeader } from "@/components/shared/page-shell";
import { StatusLine } from "@/components/shared/field-row";
import { useUnsavedChangesWarning } from "@/components/shared/use-unsaved-changes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { formatDate } from "@/components/shared/format";
import { PresetPicker } from "./preset-picker";
import { ProfileFields } from "./profile-fields";
import { useProfile } from "./use-profile";

/** Section 1: what the user tells the agent about themselves. The model never writes any of it. */
export function ProfileSection() {
  const profile = useProfile();
  const [confirmClear, setConfirmClear] = useState(false);
  useUnsavedChangesWarning(profile.dirty);

  return (
    <section aria-labelledby="profile-section" className="space-y-4">
      <SectionHeader
        id="profile-section"
        title="Profile"
        description="Framing, emphasis and depth. It changes how research is presented to you, never the evidence behind it."
      />

      {profile.error ? <StatusLine ok={false}>{profile.error}</StatusLine> : null}

      {!profile.loaded && !profile.error ? (
        <Skeleton className="h-72 w-full rounded-xl" />
      ) : (
        <Card>
          <CardContent className="space-y-5">
            <PresetPicker presets={profile.presets} onApply={profile.applyPreset} />
            <ProfileFields draft={profile.draft} onChange={profile.setDraft} />
          </CardContent>
          {/* CardFooter already draws the rule and the card's padding; module cards lay their
              footers out the same way, with the status on the left and the actions on the right. */}
          <CardFooter className="flex-wrap justify-between gap-2">
            <p className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground">
              <span className="shrink-0">
                {profile.profile ? `Updated ${formatDate(profile.profile.updatedAt)}` : "Not saved yet"}
              </span>
              {profile.path ? (
                <code className="min-w-0 truncate font-mono" title={profile.path}>
                  {profile.path}
                </code>
              ) : null}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={!profile.profile || profile.clearing}
                onClick={() => setConfirmClear(true)}
              >
                Clear profile
              </Button>
              <SaveButton dirty={profile.dirty} saving={profile.saving} onClick={() => void profile.save()} />
            </div>
          </CardFooter>
        </Card>
      )}

      <ConfirmDialog
        open={confirmClear}
        title="Clear your investor profile?"
        description="Every field is deleted and answers stop being tailored to you. Your memory and holdings are untouched."
        confirmLabel="Clear profile"
        pending={profile.clearing}
        onOpenChange={setConfirmClear}
        onConfirm={() => void profile.clear().then((cleared) => cleared && setConfirmClear(false))}
      />
    </section>
  );
}
