"use client";

import { useState } from "react";
import { toast } from "sonner";
import { deleteJson, putJson } from "@/components/shared/http-client";
import { useJson } from "@/components/shared/use-json";
import { deepEqual, errorMessage } from "@/lib/utils";
import { profilePresets } from "@/lib/profile/presets";
import type { InvestorProfile, ProfilePreset } from "@/lib/profile/types";
import { cleanDraft, toDraft, type ProfileDraft, withPreset } from "./draft";

interface ProfileResponse {
  profile: InvestorProfile | null;
  path?: string;
}

export interface ProfileState {
  profile: InvestorProfile | null;
  draft: ProfileDraft;
  path: string | null;
  presets: ProfilePreset[];
  loaded: boolean;
  error: string | null;
  dirty: boolean;
  saving: boolean;
  clearing: boolean;
  setDraft: (next: ProfileDraft) => void;
  applyPreset: (preset: ProfilePreset) => void;
  save: () => Promise<void>;
  clear: () => Promise<boolean>;
}

/** Loads and edits the investor profile and applies its presets. */
export function useProfile(): ProfileState {
  const loaded = useJson<ProfileResponse>("/api/profile");
  /** What a save or clear last stored, which replaces what was loaded. */
  const [written, setWritten] = useState<{ profile: InvestorProfile | null } | null>(null);
  /** The user's edits; `null` until they make one, so the form follows the stored profile. */
  const [edited, setDraft] = useState<ProfileDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const profile = written ? written.profile : (loaded.data?.profile ?? null);
  const baseline = toDraft(profile);
  const draft = edited ?? baseline;

  const save = async () => {
    setSaving(true);
    try {
      const body = cleanDraft(draft);
      const res = await putJson<{ profile: InvestorProfile }>("/api/profile", body);
      // Only the baseline moves, so anything edited while the request ran stays unsaved.
      setWritten({ profile: res.profile });
      toast.success("Investor profile saved");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    setClearing(true);
    try {
      await deleteJson("/api/profile");
      setWritten({ profile: null });
      setDraft(null);
      toast.success("Investor profile cleared");
      return true;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    } finally {
      setClearing(false);
    }
  };

  const applyPreset = (preset: ProfilePreset) => {
    setDraft(withPreset(draft, preset));
    toast.success(`${preset.name} filled in`, { description: "Review the fields, then press Save changes." });
  };

  return {
    profile,
    draft,
    path: loaded.data?.path ?? null,
    // Plain data shipped with the app, so there is nothing to fetch.
    presets: profilePresets,
    loaded: loaded.data !== null,
    error: loaded.error,
    // Compared after cleaning, so whitespace the user has not committed does not read as an edit.
    dirty: !deepEqual(cleanDraft(draft), cleanDraft(baseline)),
    saving,
    clearing,
    setDraft,
    applyPreset,
    save,
    clear,
  };
}
