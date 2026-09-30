"use client";

import { useRef, useState } from "react";
import { postJson } from "@/components/shared/http-client";
import { StatusLine } from "@/components/shared/field-row";
import { PendingButton } from "@/components/shared/pending-button";
import type { LlmProviderConfig, ThinkingLevel } from "@/lib/config/schema";
import type { ModelTestResult } from "@/lib/llm/types";
import { errorMessage } from "@/lib/utils";
import { requestProvider } from "./drafts";

/** Runs one real completion through `/api/settings/llm/test` against a draft provider. */
export function useModelTest() {
  const [result, setResult] = useState<ModelTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  /** Number of the newest run; a reply to an older run, or to one cleared since, is dropped. */
  const latest = useRef(0);

  const run = async (provider: LlmProviderConfig, model: string, thinkingLevel: ThinkingLevel) => {
    const request = ++latest.current;
    setTesting(true);
    setResult(null);
    let next: ModelTestResult;
    try {
      next = await postJson<ModelTestResult>("/api/settings/llm/test", {
        provider: requestProvider(provider),
        model,
        thinkingLevel,
      });
    } catch (err) {
      next = { ok: false, latencyMs: 0, reply: "", error: errorMessage(err) };
    }
    if (request !== latest.current) return;
    setResult(next);
    setTesting(false);
  };

  /** Forget the result, and any run still in flight, when the model to test changes. */
  const clear = () => {
    latest.current++;
    setResult(null);
    setTesting(false);
  };

  return { result, testing, run, clear };
}

export function TestButton({ testing, disabled, onClick }: { testing: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <PendingButton type="button" variant="outline" onClick={onClick} pending={testing} disabled={disabled}>
      Test
    </PendingButton>
  );
}

/** What the image probe found, when the tested model claimed to accept images. */
function imagesLine({ ok, latencyMs, reply, error }: NonNullable<ModelTestResult["images"]>): string {
  if (ok) return `Images: read the test image in ${latencyMs} ms`;
  const failure = error ?? "The image test failed";
  return reply ? `Images: ${failure}: “${reply}”` : `Images: ${failure}`;
}

export function ModelTestStatus({ result }: { result: ModelTestResult | null }) {
  if (!result) return null;
  // A wrapper rather than a fragment: one caller lays these out in a flex row, where two bare
  // paragraphs would sit side by side instead of stacking.
  return (
    <div className="space-y-0.5">
      <StatusLine ok={result.ok}>
        {result.ok ? `Replied in ${result.latencyMs} ms: “${result.reply}”` : (result.error ?? "Test failed")}
      </StatusLine>
      {result.thinking ? <StatusLine ok={result.thinking.ok}>{`Thinking: ${result.thinking.message}`}</StatusLine> : null}
      {result.images ? <StatusLine ok={result.images.ok}>{imagesLine(result.images)}</StatusLine> : null}
    </div>
  );
}
