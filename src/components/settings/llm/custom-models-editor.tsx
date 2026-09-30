"use client";

import { DownloadIcon, PlusIcon, XIcon } from "lucide-react";
import type { LlmModelInfo } from "@/lib/llm/types";
import { cn } from "cn";
import { FieldHelp, StatusLine } from "@/components/shared/field-row";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { CustomModelConfig, CustomThinkingConfig, ThinkingOffMode } from "@/lib/config/schema";
import { compareListed, customModelFromListing } from "./drafts";

/** Two columns on phones (id and name span both); one line per model from `sm` up. */
const rowGrid =
  "grid grid-cols-2 items-center gap-1.5 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_6.5rem_6.5rem_4.5rem_4.5rem_2rem]";

/** A positive whole number from a number input, or unset when blank or invalid. */
function toCount(value: string): number | undefined {
  const count = Number.parseInt(value, 10);
  return count > 0 ? count : undefined;
}

/** Ids that appear more than once, compared as the server will store them. */
function duplicateIds(models: CustomModelConfig[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const model of models) {
    const id = model.id.trim();
    if (id && seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return duplicates;
}

const offOptions: { value: ThinkingOffMode; label: string }[] = [
  { value: "omit", label: "Omit (server default)" },
  { value: "none", label: "reasoning_effort: none" },
  { value: "chat-template", label: "Chat template (enable_thinking: false)" },
];

/**
 * Every pi level above off. Minimal to High are sent under their own name unless named here; pi-ai
 * offers Extra high and Max only for a model that names them, so those start out not offered.
 */
const levelFields = [
  { level: "minimal", label: "Minimal", placeholder: "minimal" },
  { level: "low", label: "Low", placeholder: "low" },
  { level: "medium", label: "Medium", placeholder: "medium" },
  { level: "high", label: "High", placeholder: "high" },
  { level: "xhigh", label: "Extra high", placeholder: "not offered" },
  { level: "max", label: "Max", placeholder: "not offered" },
] as const;

/** A `thinking` block with blank entries dropped, or undefined when nothing is declared. */
function tidyThinking(thinking: CustomThinkingConfig): CustomThinkingConfig | undefined {
  const levels = Object.fromEntries(Object.entries(thinking.levels ?? {}).filter(([, name]) => name));
  const tidy: CustomThinkingConfig = {
    ...(Object.keys(levels).length > 0 ? { levels } : {}),
    ...(thinking.off && thinking.off !== "omit" ? { off: thinking.off } : {}),
  };
  return Object.keys(tidy).length > 0 ? tidy : undefined;
}

/**
 * What this server calls each thinking level and how it turns thinking off. Chat Completions does
 * not standardise either, so it is declared here; collapsed, because the defaults suit most servers.
 */
function ThinkingMapping({
  model,
  label,
  onChange,
}: {
  model: CustomModelConfig;
  label: string;
  onChange: (model: CustomModelConfig) => void;
}) {
  const thinking = model.thinking ?? {};
  const update = (next: CustomThinkingConfig) => onChange({ ...model, thinking: tidyThinking(next) });
  return (
    <details className="col-span-2 rounded-md border px-3 py-2 text-xs sm:col-span-7">
      <summary className="cursor-pointer text-muted-foreground">Advanced thinking mapping</summary>
      <div className="mt-2 grid gap-2 sm:grid-cols-4">
        {levelFields.map(({ level, label: levelLabel, placeholder }) => (
          <div key={level} className="space-y-1">
            <span className="text-muted-foreground">{levelLabel} is sent as</span>
            <Input
              aria-label={`Server name for ${level} thinking, ${label}`}
              placeholder={placeholder}
              className="font-mono"
              spellCheck={false}
              value={thinking.levels?.[level] ?? ""}
              onChange={(event) =>
                update({ ...thinking, levels: { ...thinking.levels, [level]: event.target.value.trim() ? event.target.value : undefined } })
              }
            />
          </div>
        ))}
        <div className="space-y-1">
          <span className="text-muted-foreground">Off is sent as</span>
          <Select
            value={thinking.off ?? "omit"}
            items={offOptions}
            onValueChange={(value: string | null) => update({ ...thinking, off: (value ?? "omit") as ThinkingOffMode })}
          >
            <SelectTrigger aria-label={`How thinking is turned off, ${label}`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {offOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <FieldHelp help="Level names are the reasoning_effort values this server accepts for each level. Minimal to High left blank send the level's own name (such as minimal), which some servers, vLLM and SGLang among them, reject: name it here or do not choose that level. Extra high and Max are offered only once named, and are otherwise run as High. Off: Omit sends nothing and leaves the server's default (right for models that do not think by default); reasoning_effort: none sends that value; Chat template sends chat_template_kwargs.enable_thinking = false, as vLLM and SGLang expect for Qwen. Test checks that the switch works." />
    </details>
  );
}

function ModelRow({
  model,
  index,
  duplicate,
  onChange,
  onRemove,
}: {
  model: CustomModelConfig;
  index: number;
  duplicate: boolean;
  onChange: (model: CustomModelConfig) => void;
  onRemove: () => void;
}) {
  const label = `model ${index + 1}`;
  return (
    <div className={rowGrid}>
      <Input
        aria-label={`Model id, ${label}`}
        placeholder="Model id"
        className="col-span-2 font-mono sm:col-span-1"
        spellCheck={false}
        required
        aria-invalid={!model.id.trim() || duplicate || undefined}
        value={model.id}
        onChange={(event) => onChange({ ...model, id: event.target.value })}
      />
      <Input
        aria-label={`Display name, ${label}`}
        placeholder="Display name"
        className="col-span-2 sm:col-span-1"
        value={model.name ?? ""}
        onChange={(event) => onChange({ ...model, name: event.target.value.trim() ? event.target.value : undefined })}
      />
      <div className="space-y-1">
        <Input
          aria-label={`Context window in tokens, ${label}`}
          placeholder="Context"
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          value={model.contextWindow ?? ""}
          onChange={(event) => onChange({ ...model, contextWindow: toCount(event.target.value) })}
        />
        {/* Written out rather than imported: `FALLBACK_WINDOW` in src/lib/context/budget.ts is the
            authority, but that module pulls the agent runtime into the browser bundle. */}
        {model.contextWindow ? null : (
          <Badge variant="outline" className="font-normal text-muted-foreground">
            assumed 32k
          </Badge>
        )}
      </div>
      <Input
        aria-label={`Max output tokens, ${label}`}
        placeholder="Max output"
        type="number"
        min={1}
        step={1}
        inputMode="numeric"
        value={model.maxTokens ?? ""}
        onChange={(event) => onChange({ ...model, maxTokens: toCount(event.target.value) })}
      />
      <label className="flex items-center gap-2 text-xs text-muted-foreground sm:justify-center">
        <Switch
          aria-label={`Reasoning effort, ${label}`}
          checked={model.reasoning ?? false}
          onCheckedChange={(reasoning) => onChange({ ...model, reasoning: reasoning || undefined })}
        />
        <span className="sm:hidden">Reasoning effort</span>
      </label>
      <label className="flex items-center gap-2 text-xs text-muted-foreground sm:justify-center">
        <Switch
          aria-label={`Image input, ${label}`}
          checked={model.images ?? false}
          onCheckedChange={(images) => onChange({ ...model, images: images || undefined })}
        />
        <span className="sm:hidden">Image input</span>
      </label>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="justify-self-end"
        aria-label={`Remove ${label}`}
        onClick={onRemove}
      >
        <XIcon />
      </Button>
      {model.reasoning ? <ThinkingMapping model={model} label={label} onChange={onChange} /> : null}
    </div>
  );
}

/** How the configured ids compare with what the endpoint listed at its last validation. */
function ListingSummary({ missing, configured }: { missing: string[]; configured: number }) {
  if (configured === 0) return null;
  if (missing.length === 0) return <StatusLine ok>The endpoint lists every configured model.</StatusLine>;
  return (
    <StatusLine ok={false}>
      The endpoint does not list {missing.join(", ")}. Check the id, or use Test if the endpoint serves models it does
      not list.
    </StatusLine>
  );
}

export interface CustomModelsEditorProps {
  models: CustomModelConfig[];
  onChange: (models: CustomModelConfig[]) => void;
  /** Models the endpoint listed at its last successful validation, if any. */
  listed?: LlmModelInfo[];
}

/** Hand-maintained model list of an OpenAI-compatible endpoint, with import from its `/models` listing. */
export function CustomModelsEditor({ models, onChange, listed }: CustomModelsEditorProps) {
  const duplicates = duplicateIds(models);
  const listing = listed ? compareListed(models, listed) : null;
  const configured = models.filter((model) => model.id.trim()).length;

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm leading-none font-medium">Models</legend>
      {models.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No models yet. Add the ids this endpoint serves, or validate it and add the models it lists.
        </p>
      ) : (
        <div className="space-y-2 sm:space-y-1.5">
          <div aria-hidden className={cn(rowGrid, "hidden text-xs text-muted-foreground sm:grid")}>
            <span>Model id</span>
            <span>Display name</span>
            <span>Context</span>
            <span>Max output</span>
            <span className="text-center">Reasoning</span>
            <span className="text-center">Images</span>
          </div>
          {models.map((model, index) => (
            // Rows are positional: ids change and may repeat while the user types.
            <ModelRow
              key={index}
              model={model}
              index={index}
              duplicate={duplicates.has(model.id.trim())}
              onChange={(next) => onChange(models.map((item, i) => (i === index ? next : item)))}
              onRemove={() => onChange(models.filter((_, i) => i !== index))}
            />
          ))}
        </div>
      )}
      {duplicates.size > 0 ? <StatusLine ok={false}>Each model id may be listed once.</StatusLine> : null}
      {listing ? <ListingSummary missing={listing.missing} configured={configured} /> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...models, { id: "" }])}>
          <PlusIcon />
          Add model
        </Button>
        {listing && listing.toAdd.length > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange([...models, ...listing.toAdd.map(customModelFromListing)])}
          >
            <DownloadIcon />
            Add listed models ({listing.toAdd.length})
          </Button>
        ) : null}
      </div>
      <FieldHelp help="Context and max output are token counts. A model left without a context window is assumed to hold 32k tokens, and the context meter and compaction go by that assumption, so the real window is worth entering. Turn on reasoning effort for models that accept one, so the thinking level applies to them; its Advanced thinking mapping says what the server calls each level and how it turns thinking off. Turn on Images for a model that accepts image input, otherwise the composer refuses attachments for it." />
    </fieldset>
  );
}
