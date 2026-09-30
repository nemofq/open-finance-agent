"use client";

import { useRef, useState } from "react";
import { ChevronsUpDownIcon, TriangleAlertIcon } from "lucide-react";
import type { LlmModelInfo, ProviderModels } from "@/lib/llm/types";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ModelRef } from "@/lib/config/schema";
import { modelLabel, modelRefKey, sameModelRef } from "@/lib/llm/catalog";
import { formatModelPrice, formatTokens } from "./format";

/** "128k context · $3.00 / $15.00 per M", leaving out whatever is unknown. */
function modelDetails({ contextLength, pricing }: LlmModelInfo): string {
  const parts: string[] = [];
  if (contextLength) parts.push(`${formatTokens(contextLength)} context`);
  if (pricing.input || pricing.output) parts.push(`${formatModelPrice(pricing)} per M`);
  return parts.join(" · ");
}

/** Label for a ref: "Provider · Model name" when found; falls back to the raw ids with available=false. */
export function describeModel(
  providers: ProviderModels[],
  ref: ModelRef | null,
): { label: string; available: boolean } | null {
  if (!ref) return null;
  const provider = providers.find((candidate) => candidate.provider === ref.provider);
  const model = provider?.models.find((candidate) => candidate.id === ref.model);
  if (provider && model) return { label: modelLabel(provider.name, model.name), available: true };
  return { label: modelLabel(provider?.name ?? ref.provider, ref.model), available: false };
}

/**
 * One row of the list. Nothing is truncated: aggregators such as OpenRouter name models at length
 * and tell variants apart at the end of the id, the part an ellipsis would hide.
 */
export function ModelOption({ model, isDefault = false }: { model: LlmModelInfo; isDefault?: boolean }) {
  const details = modelDetails(model);
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="flex min-w-0 items-start gap-1.5">
        <span className="min-w-0 font-medium wrap-break-word">{model.name}</span>
        {isDefault && (
          <Badge variant="secondary" className="shrink-0">
            Default
          </Badge>
        )}
      </span>
      {model.name !== model.id && (
        <span className="font-mono text-xs break-all text-muted-foreground">{model.id}</span>
      )}
      {details && <span className="text-xs tabular-nums text-muted-foreground">{details}</span>}
    </div>
  );
}

/** Room the open list wants: the search field and a full-height list. */
const POPUP_HEIGHT = 352;

/**
 * The side the list opens on, chosen once per opening: below when it fits, else the roomier side.
 * Left to Base UI, the popup flips back and forth as filtering grows and shrinks the list.
 */
export function popupSide(trigger: { top: number; bottom: number }, viewportHeight: number): "top" | "bottom" {
  const below = viewportHeight - trigger.bottom;
  return below >= POPUP_HEIGHT || below >= trigger.top ? "bottom" : "top";
}

/** Why a ref that `describeModel` marks unavailable cannot be used, for the trigger's tooltip. */
function unavailableReason(providers: ProviderModels[], ref: ModelRef): string {
  const provider = providers.find((candidate) => candidate.provider === ref.provider);
  if (!provider) return "This provider is no longer configured.";
  return provider.error ?? `${provider.name} does not list this model.`;
}

export interface ModelPickerProps {
  providers: ProviderModels[];
  value: ModelRef | null;
  onChange: (ref: ModelRef) => void;
  /** Marks this model "Default" in the list. */
  defaultModel?: ModelRef | null;
  disabled?: boolean;
  /** The providers' models are still loading: a value missing from them is not flagged as unavailable yet. */
  loading?: boolean;
  placeholder?: string;
  /** "field": full-width form control. "compact": small ghost button for the composer footer. */
  variant?: "field" | "compact";
  "aria-label"?: string;
}

/** Searchable model picker over every provider's models, grouped by provider. */
export function ModelPicker({
  providers,
  value,
  onChange,
  defaultModel,
  disabled,
  loading = false,
  placeholder = "Select a model",
  variant = "field",
  "aria-label": ariaLabel,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<"top" | "bottom">("bottom");
  // Opened upward, the list's height as the search began to filter it, held until the search is cleared.
  const [heldHeight, setHeldHeight] = useState<number | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = describeModel(providers, value);
  const unavailable = !loading && value && selected && !selected.available;
  const compact = variant === "compact";

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        const rect = trigger.current?.getBoundingClientRect();
        if (next && rect) setSide(popupSide(rect, window.innerHeight));
        setHeldHeight(null);
        setOpen(next);
      }}
    >
      <PopoverTrigger
        ref={trigger}
        disabled={disabled}
        aria-label={ariaLabel}
        title={unavailable ? `${selected.label}: ${unavailableReason(providers, value)}` : selected?.label}
        render={
          <Button
            variant={compact ? "ghost" : "outline"}
            size={compact ? "xs" : "default"}
            role="combobox"
            className={cn(
              "min-w-0 font-normal",
              compact ? "max-w-full text-muted-foreground" : "w-full",
              unavailable && "text-destructive",
            )}
          />
        }
      >
        {unavailable && <TriangleAlertIcon data-icon="inline-start" />}
        <span className={cn("min-w-0 truncate text-left", !compact && "flex-1", !selected && "text-muted-foreground")}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronsUpDownIcon data-icon="inline-end" className="opacity-50" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side={side}
        // The side stays put while the list filters; the list's height gives way to fit it instead.
        collisionAvoidance={{ side: "none", align: "shift" }}
        className="w-[min(34rem,calc(100vw-2rem))] p-0"
        aria-label="Models"
      >
        <Command defaultValue={value ? modelRefKey(value) : undefined}>
          <CommandInput
            placeholder="Search models…"
            onValueChange={(query) => {
              if (!query) setHeldHeight(null);
              else if (side === "top" && heldHeight === null) setHeldHeight(list.current?.offsetHeight ?? null);
            }}
          />
          <CommandList
            // Opened upward, the popup is pinned at its bottom edge, so a shrinking list would slide
            // the search field down under the cursor. Unfiltered, the list takes its own height up to
            // the cap, so a short one leaves no blank space; filtering holds whatever height it had.
            ref={list}
            style={heldHeight !== null ? { height: heldHeight } : undefined}
            className="max-h-[min(18rem,calc(var(--available-height)-3.5rem))]"
          >
            <CommandEmpty>No models found.</CommandEmpty>
            {providers.map((provider) => (
              <CommandGroup key={provider.provider} value={provider.provider} heading={provider.name}>
                {provider.error && <p className="px-2 py-1.5 text-xs text-muted-foreground">{provider.error}</p>}
                {provider.models.map((model) => {
                  const ref = { provider: provider.provider, model: model.id };
                  return (
                    <CommandItem
                      key={model.id}
                      value={modelRefKey(ref)}
                      keywords={[provider.name, model.name, model.id]}
                      data-checked={sameModelRef(ref, value) ? "true" : undefined}
                      onSelect={() => {
                        onChange(ref);
                        setOpen(false);
                      }}
                    >
                      <ModelOption model={model} isDefault={sameModelRef(ref, defaultModel)} />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
