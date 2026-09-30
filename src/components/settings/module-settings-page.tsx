"use client";

import { SettingsHeader } from "@/components/shared/page-shell";
import { useUnsavedChangesWarning } from "@/components/shared/use-unsaved-changes";
import type { McpServerClass } from "@/lib/config/schema";
import type { Module } from "@/lib/tools/contracts";
import { McpServersSection } from "./mcp-servers-section";
import { ModuleCards } from "./module-cards";
import { useSettings } from "./use-settings";

export interface ModuleSettingsPageProps {
  kind: Module["kind"];
  title: string;
  description: string;
  /** Shown when no module of this kind is registered: where one would be added. */
  emptyHint: string;
  /** The MCP servers listed under the modules, if this page takes any. */
  mcpClass?: McpServerClass;
}

/** A settings page of module cards of one kind, optionally followed by that class's MCP servers. */
export function ModuleSettingsPage({ kind, title, description, emptyHint, mcpClass }: ModuleSettingsPageProps) {
  // One store per page: modules and MCP servers save into the same config, from the same baseline.
  const store = useSettings();
  useUnsavedChangesWarning(store.dirty);

  return (
    <div className="space-y-8">
      <SettingsHeader title={title} description={description} />
      <ModuleCards store={store} kind={kind} emptyHint={emptyHint} />
      {mcpClass ? <McpServersSection store={store} serverClass={mcpClass} /> : null}
    </div>
  );
}
