"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { enablesOnSave, moduleSettings } from "@/lib/tools/config";
import type { Module, ModuleSummary } from "@/lib/tools/contracts";
import { useJson } from "@/components/shared/use-json";
import { ModuleSettingsForm } from "./module-settings-form";
import { EmptyState } from "@/components/shared/page-shell";
import { StatusLine } from "@/components/shared/field-row";
import { type ModuleConfigEntry, moduleUnit } from "./settings-units";
import type { SettingsStore } from "./use-settings";

/** The config schema requires a boolean `enabled` on every module entry. */
function withEnabled(value: Record<string, unknown>): ModuleConfigEntry {
  return { ...value, enabled: value.enabled === true };
}

export interface ModuleCardsProps {
  /** The page's one store: a second `useSettings()` would save from its own stale baseline. */
  store: SettingsStore;
  kind: Module["kind"];
  emptyHint: string;
}

/** A settings card for every registered module of one kind. Each settings page renders one of these. */
export function ModuleCards({ store, kind, emptyHint }: ModuleCardsProps) {
  const { config, saved, loadError, update, isDirty, isSaving, saveUnit, setUnitEnabled } = store;
  const listing = useJson<{ modules: ModuleSummary[] }>("/api/settings/modules");
  const modules = listing.data?.modules ?? null;

  const error = loadError ?? listing.error;
  const visible = (modules ?? []).filter((module) => module.kind === kind);

  return (
    <div className="space-y-4">
      {error ? <StatusLine ok={false}>{error}</StatusLine> : null}

      {!config || modules === null ? (
        <Skeleton className="h-52 w-full rounded-xl" />
      ) : visible.length === 0 ? (
        <EmptyState>
          <p>No modules registered yet.</p>
          <p className="mt-1">{emptyHint}</p>
        </EmptyState>
      ) : (
        visible.map((module) => {
          // Each card saves only its own module entry; its Enabled switch persists just that flag.
          const unit = moduleUnit(module.id);
          return (
            <ModuleSettingsForm
              key={module.id}
              module={module}
              config={moduleSettings(config.modules, module)}
              onChange={(next) => update((current) => unit.write(current, withEnabled(next)))}
              onEnabledChange={(enabled) =>
                void setUnitEnabled(unit, enabled, {
                  success: `${module.name} ${enabled ? "enabled" : "disabled"}`,
                  fallback: withEnabled(module.defaultConfig),
                })
              }
              onSave={() => {
                // Filling in what an off module was missing is taken as wanting it on.
                const draft = unit.read(config);
                if (draft && enablesOnSave(module, saved?.modules, config.modules)) {
                  void saveUnit(unit, { value: { ...draft, enabled: true }, success: `${module.name} saved and enabled` });
                } else {
                  void saveUnit(unit, { success: `${module.name} saved` });
                }
              }}
              saving={isSaving(unit)}
              dirty={isDirty(unit)}
            />
          );
        })
      )}
    </div>
  );
}
