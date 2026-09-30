"use client";

import { useId, useState } from "react";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { McpServerClass, McpServerConfig } from "@/lib/config/schema";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { getJson } from "@/components/shared/http-client";
import { PendingButton } from "@/components/shared/pending-button";
import { useDialogSubject } from "@/components/shared/use-dialog-subject";
import { errorMessage } from "@/lib/utils";
import { McpServerForm } from "./mcp-server-form";
import { EnabledSwitch, SaveButton, SectionHeader } from "@/components/shared/page-shell";
import { StatusLine } from "@/components/shared/field-row";
import { mcpServerUnit } from "./settings-units";
import { serverClass as classOf } from "@/lib/mcp/server-class";
import type { McpToolInfo } from "@/lib/mcp/types";
import { ToolAllowlist } from "./tool-allowlist";
import type { SettingsStore } from "./use-settings";

type Probe =
  | { status: "loading" }
  | { status: "ok"; tools: McpToolInfo[] }
  | { status: "error"; message: string };

/** What the section says about itself, and what it says when the user has none of its class yet. */
const sectionCopy: Record<McpServerClass, { description: string; empty: string }> = {
  data: {
    description:
      "Model Context Protocol servers marked as data connections. What they return is kept as evidence, ranked by the tier you give them.",
    empty: "No MCP data connections yet. A server added here starts as a data connection at tier 2.",
  },
  general: {
    description: "Model Context Protocol servers that are not data connections. Add any HTTP or stdio server.",
    empty: "No general MCP servers yet. A server added here starts as a general tool.",
  },
};

function endpointOf(server: McpServerConfig): string {
  if (server.transport === "http") return server.url || "No URL set";
  return [server.command, ...(server.args ?? [])].filter(Boolean).join(" ") || "No command set";
}

function StatusPill({ probe }: { probe: Probe | undefined }) {
  if (!probe) return <Badge variant="outline">Not checked</Badge>;
  if (probe.status === "loading") return <Badge variant="outline">Checking…</Badge>;
  if (probe.status === "error") return <Badge variant="destructive">Unavailable</Badge>;
  return <Badge variant="secondary">{probe.tools.length} tools</Badge>;
}

interface ServerCardProps {
  server: McpServerConfig;
  probe: Probe | undefined;
  dirty: boolean;
  saving: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onAllowToolsChange: (tools: string[]) => void;
  onTest: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSave: () => void;
}

/** One server: its Enabled switch applies at once; allowlist edits wait for the card's Save. */
function ServerCard({
  server,
  probe,
  dirty,
  saving,
  onEnabledChange,
  onAllowToolsChange,
  onTest,
  onEdit,
  onDelete,
  onSave,
}: ServerCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {server.name}
          <Badge variant="outline" className="font-mono">
            {server.transport}
          </Badge>
          <StatusPill probe={probe} />
        </CardTitle>
        <CardDescription className="truncate font-mono text-xs">{endpointOf(server)}</CardDescription>
        <CardAction>
          <EnabledSwitch checked={server.enabled} disabled={saving} onCheckedChange={onEnabledChange} />
        </CardAction>
      </CardHeader>
      {probe && probe.status !== "loading" ? (
        <CardContent>
          {probe.status === "error" ? (
            <StatusLine ok={false}>{probe.message}</StatusLine>
          ) : probe.tools.length === 0 ? (
            <StatusLine ok>This server exposes no tools.</StatusLine>
          ) : (
            <ToolAllowlist tools={probe.tools} value={server.allowTools ?? []} onChange={onAllowToolsChange} />
          )}
        </CardContent>
      ) : null}
      <CardFooter className="flex-wrap justify-between gap-2">
        <PendingButton variant="outline" onClick={onTest} pending={probe?.status === "loading"}>
          Test connection
        </PendingButton>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onEdit}>
            <PencilIcon />
            Edit
          </Button>
          <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={onDelete}>
            <Trash2Icon />
            Delete
          </Button>
          <SaveButton dirty={dirty} saving={saving} onClick={onSave} />
        </div>
      </CardFooter>
    </Card>
  );
}

export interface McpServersSectionProps {
  /** The page's one store, shared with its module cards. */
  store: SettingsStore;
  /** The class of server this section lists, and what a server added here starts as. */
  serverClass: McpServerClass;
}

/** The MCP servers of one class, under the module cards of the page they belong to. */
export function McpServersSection({ store, serverClass }: McpServersSectionProps) {
  const { config, loadError, update, isDirty, isSaving, saveUnit, removeUnit, setUnitEnabled } = store;
  const headingId = useId();
  const editing = useDialogSubject<McpServerConfig>();
  const [pendingDelete, setPendingDelete] = useState<McpServerConfig | null>(null);
  const [probes, setProbes] = useState<Record<string, Probe>>({});

  const servers = (config?.mcp.servers ?? []).filter((server) => classOf(server) === serverClass);
  const deleting = pendingDelete !== null && isSaving(mcpServerUnit(pendingDelete.id));

  const setAllowTools = (id: string, tools: string[]) => {
    const unit = mcpServerUnit(id);
    update((current) => {
      const server = unit.read(current);
      return server ? unit.write(current, { ...server, allowTools: tools.length > 0 ? tools : undefined }) : current;
    });
  };

  // Connection details are saved by the dialog, so the stored server (with its real secrets, not
  // the masks the page holds) is what gets tested.
  const probe = async (id: string) => {
    setProbes((current) => ({ ...current, [id]: { status: "loading" } }));
    try {
      const res = await getJson<{ tools: McpToolInfo[] }>(`/api/mcp/servers/${encodeURIComponent(id)}/tools`);
      setProbes((current) => ({ ...current, [id]: { status: "ok", tools: res.tools ?? [] } }));
    } catch (err) {
      setProbes((current) => ({ ...current, [id]: { status: "error", message: errorMessage(err) } }));
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const removed = await removeUnit(mcpServerUnit(pendingDelete.id), { success: `${pendingDelete.name} deleted` });
    if (removed) setPendingDelete(null);
  };

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <SectionHeader
        id={headingId}
        title="MCP servers"
        description={sectionCopy[serverClass].description}
        action={
          config ? (
            <Button variant="outline" onClick={() => editing.show()}>
              <PlusIcon />
              Add server
            </Button>
          ) : null
        }
      />

      {!config ? (
        // The page's module cards report a failed load; until the config arrives there is nothing to list.
        loadError ? null : (
          <Skeleton className="h-24 w-full rounded-xl" />
        )
      ) : servers.length === 0 ? (
        <p className="text-sm text-muted-foreground">{sectionCopy[serverClass].empty}</p>
      ) : (
        <div className="space-y-4">
          {servers.map((server) => {
            const unit = mcpServerUnit(server.id);
            return (
              <ServerCard
                key={server.id}
                server={server}
                probe={probes[server.id]}
                dirty={isDirty(unit)}
                saving={isSaving(unit)}
                onEnabledChange={(enabled) =>
                  void setUnitEnabled(unit, enabled, { success: `${server.name} ${enabled ? "enabled" : "disabled"}` })
                }
                onAllowToolsChange={(tools) => setAllowTools(server.id, tools)}
                onTest={() => void probe(server.id)}
                onEdit={() => editing.show(server)}
                onDelete={() => setPendingDelete(server)}
                onSave={() => void saveUnit(unit, { success: `${server.name} saved` })}
              />
            );
          })}
        </div>
      )}

      <McpServerForm
        key={editing.key}
        open={editing.open}
        initial={editing.subject}
        addAs={serverClass}
        onOpenChange={editing.onOpenChange}
        onSubmit={(server, onError) =>
          saveUnit(mcpServerUnit(server.id), {
            value: server,
            success: `${server.name} ${editing.subject ? "saved" : "added"}`,
            onError,
          })
        }
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete “${pendingDelete?.name ?? "server"}”?`}
        description="The server is removed from your settings now and its tools stop being offered to the agent."
        confirmLabel="Delete"
        pending={deleting}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  );
}
