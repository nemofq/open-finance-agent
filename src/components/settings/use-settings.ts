"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { AppConfig } from "@/lib/config/schema";
import { getJson, putJson } from "@/components/shared/http-client";
import { deepEqual, errorMessage } from "@/lib/utils";
import {
  enabledChange,
  removeChange,
  saveChange,
  type SettingsUnit,
  type UnitChange,
  unitDirty,
} from "./settings-units";

export interface SettingsStore {
  /** The draft: the saved config plus every unit's unsaved edits. */
  config: AppConfig | null;
  /** The config as the server last returned it. */
  saved: AppConfig | null;
  loadError: string | null;
  /** True while any unit has unsaved edits; pass it to `useUnsavedChangesWarning`. */
  dirty: boolean;
  /** Apply an immutable update to the draft, e.g. `update((c) => unit.write(c, next))`. */
  update: (apply: (current: AppConfig) => AppConfig) => void;
  /** Whether the unit has unsaved edits; drives its Save button. */
  isDirty: <T>(unit: SettingsUnit<T>) => boolean;
  /** Whether a change to the unit is being saved or waits its turn; drives its spinner. */
  isSaving: (unit: { key: string }) => boolean;
  /**
   * Persist the unit's draft value, or `value` from an Add or Edit dialog. Other units' edits are not
   * sent. A failure goes to `onError`, for a dialog that shows it inline, instead of a toast.
   */
  saveUnit: <T>(
    unit: SettingsUnit<T>,
    options?: { value?: T; success?: string; onError?: (message: string) => void },
  ) => Promise<boolean>;
  /** Persist the unit's removal; call it once the page has confirmed. */
  removeUnit: <T>(unit: SettingsUnit<T>, options?: { success?: string }) => Promise<boolean>;
  /**
   * Persist only the unit's `enabled` flag; its other unsaved edits stay in the draft. A unit not
   * saved yet is sent as `fallback` (its defaults) with the flag set.
   */
  setUnitEnabled: <T extends { enabled: boolean }>(
    unit: SettingsUnit<T>,
    enabled: boolean,
    options?: { success?: string; fallback?: T },
  ) => Promise<boolean>;
}

/** Loads `/api/settings` once and saves it one unit at a time; see `settings-units.ts`. */
export function useSettings(): SettingsStore {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [saved, setSaved] = useState<AppConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** In-flight or queued changes per unit key. */
  const [pending, setPending] = useState<Record<string, number>>({});
  /** The latest server reply, read when a queued change builds its request. */
  const savedRef = useRef<AppConfig | null>(null);
  /** Changes run one at a time, so each request starts from the reply to the one before. */
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    let active = true;
    getJson<AppConfig>("/api/settings")
      .then((next) => {
        if (!active) return;
        savedRef.current = next;
        setConfig(next);
        setSaved(next);
      })
      .catch((err: unknown) => {
        if (active) setLoadError(errorMessage(err));
      });
    return () => {
      active = false;
    };
  }, []);

  const update = useCallback((apply: (current: AppConfig) => AppConfig) => {
    setConfig((current) => (current ? apply(current) : current));
  }, []);

  const track = useCallback((key: string, delta: 1 | -1) => {
    setPending(({ [key]: count = 0, ...rest }) => (count + delta > 0 ? { ...rest, [key]: count + delta } : rest));
  }, []);

  const commit = useCallback(
    async (key: string, change: UnitChange, success: string, onError: (message: string) => void = toast.error) => {
      track(key, 1);
      const run = queue.current.then(async () => {
        const base = savedRef.current;
        if (!base) return false;
        try {
          const server = await putJson<AppConfig>("/api/settings", change.request(base));
          savedRef.current = server;
          setSaved(server);
          setConfig((draft) => (draft ? change.rebase(draft, server) : draft));
          toast.success(success);
          return true;
        } catch (err) {
          onError(errorMessage(err));
          return false;
        }
      });
      queue.current = run;
      try {
        return await run;
      } finally {
        track(key, -1);
      }
    },
    [track],
  );

  const saveUnit = useCallback(
    <T>(unit: SettingsUnit<T>, options: { value?: T; success?: string; onError?: (message: string) => void } = {}) => {
      const before = config ? unit.read(config) : undefined;
      const value = options.value ?? before;
      if (value === undefined) return Promise.resolve(false);
      return commit(unit.key, saveChange(unit, value, before), options.success ?? "Settings saved", options.onError);
    },
    [commit, config],
  );

  const removeUnit = useCallback(
    <T>(unit: SettingsUnit<T>, options: { success?: string } = {}) =>
      commit(unit.key, removeChange(unit), options.success ?? "Deleted"),
    [commit],
  );

  const setUnitEnabled = useCallback(
    <T extends { enabled: boolean }>(
      unit: SettingsUnit<T>,
      enabled: boolean,
      { success, fallback }: { success?: string; fallback?: T } = {},
    ) => commit(unit.key, enabledChange(unit, enabled, fallback), success ?? (enabled ? "Enabled" : "Disabled")),
    [commit],
  );

  return {
    config,
    saved,
    loadError,
    dirty: config !== null && saved !== null && !deepEqual(config, saved),
    update,
    isDirty: (unit) => config !== null && saved !== null && unitDirty(unit, config, saved),
    isSaving: (unit) => (pending[unit.key] ?? 0) > 0,
    saveUnit,
    removeUnit,
    setUnitEnabled,
  };
}
