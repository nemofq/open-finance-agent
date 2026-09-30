"use client";

import { useState } from "react";
import { ModelPicker } from "@/components/shared/model-picker";
import type { LlmProviderConfig, ModelRef, ThinkingLevel } from "@/lib/config/schema";
import type { ProviderModels } from "@/lib/llm/types";
import { ModelTestStatus, TestButton, useModelTest } from "./model-test";

export interface ProviderTestProps {
  provider: LlmProviderConfig;
  models: ProviderModels;
  defaultModel: ModelRef | null;
  thinkingLevel: ThinkingLevel;
}

/** Pick one of a provider's models and run a real completion on it. */
export function ProviderTest({ provider, models, defaultModel, thinkingLevel }: ProviderTestProps) {
  const [picked, setPicked] = useState<string | null>(null);
  const test = useModelTest();

  const ids = models.models.map((model) => model.id);
  const usesDefault = defaultModel?.provider === provider.id && ids.includes(defaultModel.model);
  const modelId = picked && ids.includes(picked) ? picked : usesDefault ? defaultModel.model : (ids[0] ?? null);

  return (
    <div className="space-y-1.5">
      <p className="text-sm leading-none font-medium">Test a model</p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full min-w-0 sm:w-80">
          <ModelPicker
            providers={[models]}
            value={modelId ? { provider: provider.id, model: modelId } : null}
            onChange={(ref) => {
              test.clear();
              setPicked(ref.model);
            }}
            defaultModel={defaultModel}
            disabled={ids.length === 0}
            placeholder={models.error ?? "No models to test yet"}
            aria-label={`Model to test on ${models.name}`}
          />
        </div>
        <TestButton
          testing={test.testing}
          disabled={!modelId}
          onClick={() => {
            if (modelId) void test.run(provider, modelId, thinkingLevel);
          }}
        />
      </div>
      <ModelTestStatus result={test.result} />
    </div>
  );
}
