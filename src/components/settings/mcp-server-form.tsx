"use client";

import { useState } from "react";
import { serverClass as classOf } from "@/lib/mcp/server-class";
import { PlusIcon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { coverageDomains, type McpServerClass, type McpServerConfig } from "@/lib/config/schema";
import type { CoverageDomain, SourceTier } from "@/lib/tools/contracts";
import { SECRET_MASK } from "@/lib/config/secrets";
import { CheckboxGroup, EnumField, Field, type Option } from "@/components/shared/field-row";
import { deepEqual } from "@/lib/utils";
import { FormDialog } from "@/components/shared/form-dialog";
import { useUnsavedChangesWarning } from "@/components/shared/use-unsaved-changes";

/** `slug-xxxx`: readable in tool names, unique enough for a local, single-user config. */
function makeServerId(name: string): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "server";
  return `${slug}-${Math.random().toString(36).slice(2, 6)}`;
}

/** A new server, as the section that opened the dialog means it: a data connection also gets a tier. */
function emptyServer(serverClass: McpServerClass): McpServerConfig {
  const server: McpServerConfig = { id: "", name: "", enabled: true, transport: "http", url: "", class: serverClass };
  return serverClass === "data" ? { ...server, tier: defaultTier } : server;
}

type Pairs = [string, string][];

const toPairs = (record: Record<string, string> | undefined): Pairs => Object.entries(record ?? {});

const fromPairs = (pairs: Pairs): Record<string, string> | undefined => {
  const entries = pairs.filter(([key]) => key.trim() !== "");
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

function KeyValueRows({
  legend,
  placeholderKey,
  pairs,
  onChange,
}: {
  legend: string;
  placeholderKey: string;
  pairs: Pairs;
  onChange: (next: Pairs) => void;
}) {
  const setPair = (index: number, key: string, value: string) =>
    onChange(pairs.map((pair, i) => (i === index ? [key, value] : pair)));

  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm leading-none font-medium">{legend}</legend>
      {pairs.map(([key, value], index) => {
        // A stored value comes back as the mask and is restored by its name on save, so typing
        // replaces the mask and renaming the row asks for the value again.
        const stored = value === SECRET_MASK;
        return (
          // Rows are positional: names repeat while the user types, so the index is the stable key.
          <div key={index} className="flex gap-1.5">
            <Input
              aria-label={`${legend} name ${index + 1}`}
              placeholder={placeholderKey}
              value={key}
              onChange={(event) => setPair(index, event.target.value, stored ? "" : value)}
            />
            <Input
              aria-label={`${legend} value ${index + 1}`}
              placeholder="value"
              value={value}
              onChange={(event) =>
                setPair(index, key, stored ? event.target.value.replaceAll("\u2022", "") : event.target.value)
              }
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove ${legend} row ${index + 1}`}
              onClick={() => onChange(pairs.filter((_, i) => i !== index))}
            >
              <XIcon />
            </Button>
          </div>
        );
      })}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...pairs, ["", ""]])}>
        <PlusIcon />
        Add row
      </Button>
    </fieldset>
  );
}

const transports: Option<McpServerConfig["transport"]>[] = [
  { value: "http", label: "HTTP (Streamable)" },
  { value: "stdio", label: "stdio (local process)" },
];

const serverClasses: Option<McpServerClass>[] = [
  { value: "data", label: "Data connection" },
  { value: "general", label: "General tool" },
];

const classHelp: Record<McpServerClass, string> = {
  data: "Supplies market or filing data. What it returns is kept as evidence and ranked by its source tier.",
  general: "Does something else — search, automation, local files. What it returns is not evidence.",
};

const tiers: { value: SourceTier; label: string }[] = [
  { value: 1, label: "1 — Primary (regulatory filings, issuer releases)" },
  { value: 2, label: "2 — Licensed vendor (market-data provider)" },
  { value: 3, label: "3 — Allowlisted press (reputable financial press)" },
  { value: 4, label: "4 — Open web (everything else)" },
];

/** Most connections a user adds are market-data vendors. */
const defaultTier: SourceTier = 2;

const coverageLabels: Record<CoverageDomain, string> = {
  filings: "Filings",
  fundamentals: "Fundamentals",
  earnings: "Earnings",
  estimates: "Analyst estimates",
  prices: "Prices",
  options: "Options",
  funds: "Funds and ETFs",
  transcripts: "Transcripts",
  news: "News",
  ownership: "Ownership (insiders, institutions)",
  macro: "Macro (rates, inflation)",
};

const coverageOptions: Option<CoverageDomain>[] = coverageDomains.map((value) => ({ value, label: coverageLabels[value] }));

export interface McpServerFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omitted when adding; the server being edited otherwise. */
  initial?: McpServerConfig;
  /** What a new server starts as, from the settings section that opened the dialog; ignored when editing. */
  addAs: McpServerClass;
  /** Persists the server and resolves true on success; a failure's message goes to `onError`. */
  onSubmit: (server: McpServerConfig, onError: (message: string) => void) => Promise<boolean>;
}

/**
 * Add/edit dialog for one MCP server, which closes once `onSubmit` has saved it and stays open
 * with the error when saving fails. The draft is seeded from `initial` at mount, so the caller must remount this
 * component (change its `key`) each time the dialog is opened.
 */
export function McpServerForm({ open, onOpenChange, initial, addAs, onSubmit }: McpServerFormProps) {
  const [seed] = useState(() => {
    const server = initial ?? emptyServer(addAs);
    return {
      // A server saved before the class field existed counts as general; seeding that value keeps
      // the unsaved-changes guard quiet until the user actually changes something.
      server: { ...server, class: classOf(server) },
      headers: toPairs(initial?.headers),
      env: toPairs(initial?.env),
    };
  });
  const [draft, setDraft] = useState<McpServerConfig>(seed.server);
  const [headers, setHeaders] = useState<Pairs>(seed.headers);
  const [env, setEnv] = useState<Pairs>(seed.env);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The modal blocks in-app links, so this guards closing or reloading the tab and the New chat shortcut.
  useUnsavedChangesWarning(open && !deepEqual({ server: draft, headers, env }, seed));

  const patch = (fields: Partial<McpServerConfig>) => setDraft((current) => ({ ...current, ...fields }));

  const serverClass: McpServerClass = classOf(draft);
  const coverage: CoverageDomain[] = draft.coverage ?? [];

  const setServerClass = (value: McpServerClass) =>
    setDraft((current) =>
      value === "data"
        ? { ...current, class: "data", tier: current.tier ?? defaultTier }
        : // Dropping the data fields keeps a tier the user no longer means out of the saved config.
          { ...current, class: "general", tier: undefined, coverage: undefined },
    );

  const submit = async () => {
    const name = draft.name.trim() || "Unnamed server";
    const isData = serverClass === "data";
    const server: McpServerConfig = {
      ...draft,
      name,
      id: draft.id || makeServerId(name),
      // Written out either way so a server saved before the field existed stops being ambiguous.
      class: isData ? "data" : "general",
      tier: isData ? (draft.tier ?? defaultTier) : undefined,
      coverage: isData ? coverage : undefined,
      headers: draft.transport === "http" ? fromPairs(headers) : undefined,
      url: draft.transport === "http" ? draft.url?.trim() : undefined,
      command: draft.transport === "stdio" ? draft.command?.trim() : undefined,
      args: draft.transport === "stdio" ? draft.args : undefined,
      env: draft.transport === "stdio" ? fromPairs(env) : undefined,
    };
    setSaving(true);
    setError(null);
    const saved = await onSubmit(server, setError);
    setSaving(false);
    if (saved) onOpenChange(false);
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        <span className="flex items-center gap-2">
          {initial ? "Edit MCP server" : "Add MCP server"}
          <Badge variant={serverClass === "data" ? "secondary" : "outline"}>
            {serverClass === "data" ? `Data · tier ${draft.tier ?? defaultTier}` : "General tool"}
          </Badge>
        </span>
      }
      description="Tools this server exposes become available to the agent once it is enabled."
      error={error}
      submitLabel={initial ? "Save server" : "Add server"}
      submitting={saving}
      canSubmit={draft.name.trim() !== ""}
      onSubmit={() => void submit()}
    >
      <div className="space-y-4">
        <Field label="Name">
          {(id) => (
            <Input
              id={id}
              value={draft.name}
              placeholder="Alpha Vantage"
              onChange={(event) => patch({ name: event.target.value })}
            />
          )}
        </Field>

        <EnumField
          label="What is this server?"
          value={serverClass}
          options={serverClasses}
          help={classHelp[serverClass]}
          required
          onChange={(value) => value && setServerClass(value)}
        />

        {serverClass === "data" ? (
          <>
            <Field label="Source tier">
              {(id) => (
                <Select
                  value={draft.tier ?? defaultTier}
                  items={tiers}
                  onValueChange={(value: SourceTier | null) => patch({ tier: value ?? defaultTier })}
                >
                  <SelectTrigger id={id} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {tiers.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>

            <CheckboxGroup
              legend="Coverage"
              options={coverageOptions}
              value={coverage}
              help="What this connection can answer for. A domain no connection covers is left open to web search."
              onChange={(next) => patch({ coverage: next })}
            />
          </>
        ) : null}

        <EnumField
          label="Transport"
          value={draft.transport}
          options={transports}
          required
          onChange={(transport) => transport && patch({ transport })}
        />

        {draft.transport === "http" ? (
          <>
            <Field label="URL">
              {(id) => (
                <Input
                  id={id}
                  value={draft.url ?? ""}
                  placeholder="https://mcp.example.com/mcp"
                  onChange={(event) => patch({ url: event.target.value })}
                />
              )}
            </Field>
            <KeyValueRows
              legend="Headers"
              placeholderKey="Authorization"
              pairs={headers}
              onChange={setHeaders}
            />
          </>
        ) : (
          <>
            <Field label="Command">
              {(id) => (
                <Input
                  id={id}
                  value={draft.command ?? ""}
                  placeholder="npx"
                  className="font-mono"
                  onChange={(event) => patch({ command: event.target.value })}
                />
              )}
            </Field>
            <Field label="Arguments" help="One argument per line.">
              {(id) => (
                <Textarea
                  id={id}
                  rows={3}
                  className="font-mono"
                  value={(draft.args ?? []).join("\n")}
                  onChange={(event) =>
                    patch({ args: event.target.value.split("\n").filter((line) => line.trim() !== "") })
                  }
                />
              )}
            </Field>
            <KeyValueRows legend="Environment" placeholderKey="API_KEY" pairs={env} onChange={setEnv} />
          </>
        )}

        <Field
          label="Cache TTL (seconds)"
          help="Cache identical tool calls for this long. Leave blank to call the server every time."
        >
          {(id) => (
            <Input
              id={id}
              type="number"
              min={0}
              inputMode="numeric"
              value={draft.cacheTtlSeconds ?? ""}
              placeholder="Off"
              onChange={(event) =>
                patch({
                  cacheTtlSeconds: event.target.value === "" ? undefined : Number(event.target.value),
                })
              }
            />
          )}
        </Field>
      </div>
    </FormDialog>
  );
}
