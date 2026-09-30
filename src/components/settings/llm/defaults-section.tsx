"use client";

import { useId } from "react";
import { ModelPicker } from "@/components/shared/model-picker";
import { SaveButton, SectionHeader } from "@/components/shared/page-shell";
import { EnumField, FieldHelp, type Option, StatusLine } from "@/components/shared/field-row";
import type { LlmDefaults } from "@/components/settings/settings-units";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { type LlmProviderConfig, type ThinkingLevel, thinkingLevels } from "@/lib/config/schema";
import { modelMissingMessage } from "@/lib/llm/catalog";
import { runsAs } from "@/lib/llm/thinking-clamp";
import type { ProviderModels } from "@/lib/llm/types";
import { ModelTestStatus, TestButton, useModelTest } from "./model-test";

const thinkingLabels: Record<ThinkingLevel, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

/**
 * The levels the default model accepts, or every level while it or its levels are unknown. The
 * saved level stays listed even when the model does not accept it, so the picker can still show it.
 */
function thinkingOptions(level: ThinkingLevel, supported: ThinkingLevel[] | undefined): Option<ThinkingLevel>[] {
  return thinkingLevels
    .filter((candidate) => candidate === level || !supported || supported.includes(candidate))
    .map((value) => ({ value, label: thinkingLabels[value] }));
}

/** What the default model runs a level it does not accept as, the way pi-ai clamps it. */
function clampHint(level: ThinkingLevel, supported: ThinkingLevel[] | undefined): string | undefined {
  if (!supported || supported.includes(level)) return undefined;
  const runs = runsAs(level, supported);
  return runs
    ? `This model runs ${thinkingLabels[level]} as ${thinkingLabels[runs]}.`
    : "This model cannot turn thinking off, so Off runs at its provider's default effort.";
}

export interface DefaultsSectionProps {
  /** The draft default model and thinking level. */
  defaults: LlmDefaults;
  /** The saved providers, which Test runs against. */
  providers: LlmProviderConfig[];
  /** The saved providers' models, from `savedProviderModels`. */
  providerModels: ProviderModels[];
  /** Saved providers' models are still loading, so a default missing from them is not flagged yet. */
  loading: boolean;
  /** Some provider card has unsaved edits, which the picker leaves out until they are saved. */
  unsavedProviders: boolean;
  onChange: (fields: Partial<LlmDefaults>) => void;
  /** The defaults differ from their saved copy. */
  dirty: boolean;
  saving: boolean;
  /** Save the default model and thinking level only. */
  onSave: () => void;
}

/** The default model for new chats, with a Test, and the thinking level every chat uses; saved on their own. */
export function DefaultsSection({
  defaults,
  providers,
  providerModels,
  loading,
  unsavedProviders,
  onChange,
  dirty,
  saving,
  onSave,
}: DefaultsSectionProps) {
  const headingId = useId();
  const test = useModelTest();
  const ref = defaults.defaultModel;
  const provider = ref ? providers.find((candidate) => candidate.id === ref.provider) : undefined;
  const noProviders = providerModels.length === 0;
  const listed = ref ? providerModels.find((entry) => entry.provider === ref.provider) : undefined;
  const model = ref ? listed?.models.find((candidate) => candidate.id === ref.model) : undefined;
  const supported = model?.thinkingLevels;
  // A provider that lists its models without this one has retired it; nothing stands in for it.
  const missing = !loading && ref && listed && !listed.error && !model ? modelMissingMessage(listed.name, ref.model) : undefined;
  const hint = clampHint(defaults.thinkingLevel, supported);

  return (
    <section aria-labelledby={headingId} className="@container space-y-3">
      <SectionHeader id={headingId} title="Defaults" description="What new chats start with." />
      <Card>
        <CardContent className="grid items-start gap-6 @2xl:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-sm leading-none font-medium">Default model</p>
            <ModelPicker
              providers={providerModels}
              value={ref}
              onChange={(defaultModel) => {
                test.clear();
                onChange({ defaultModel });
              }}
              disabled={noProviders}
              loading={loading}
              placeholder={noProviders ? "Add a provider first" : "Select a model"}
              aria-label="Default model"
            />
            {missing ? <StatusLine ok={false}>{missing} Pick another model.</StatusLine> : null}
            <FieldHelp help="New chats start on this model; you can pick another before sending the first message." />
            {unsavedProviders ? <FieldHelp help="Unsaved provider changes appear here after you save them." /> : null}
          </div>

          <div className="space-y-1.5">
            <EnumField
              label="Thinking level"
              value={defaults.thinkingLevel}
              options={thinkingOptions(defaults.thinkingLevel, supported)}
              help="Reasoning effort for every chat, on pi-ai's scale; the list shows the levels the default model offers, and endpoint models get them once marked for reasoning effort. Higher levels cost more and answer slower, and Max can use many tokens and hit the per-turn limits."
              required
              onChange={(thinkingLevel) => thinkingLevel && onChange({ thinkingLevel })}
            />
            {hint ? <FieldHelp help={hint} /> : null}
          </div>
        </CardContent>
        <CardFooter className="flex-wrap justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <TestButton
              testing={test.testing}
              disabled={!provider}
              onClick={() => {
                if (provider && ref) void test.run(provider, ref.model, defaults.thinkingLevel);
              }}
            />
            <ModelTestStatus result={test.result} />
          </div>
          <SaveButton dirty={dirty} saving={saving} onClick={onSave} />
        </CardFooter>
      </Card>
    </section>
  );
}
