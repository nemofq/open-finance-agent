"use client";

import type { LlmModelsResponse } from "@/lib/llm/types";
import { type Loaded, useJson } from "./use-json";

/** Loads every configured provider's models and the default model, for the model pickers. */
export function useLlmModels(): Loaded<LlmModelsResponse> {
  return useJson<LlmModelsResponse>("/api/settings/llm/models");
}
