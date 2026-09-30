"use client";

import { LightbulbIcon } from "lucide-react";
import { Disclosure } from "@/components/shared/disclosure";
import { thoughtLabel } from "./transcript";

/**
 * The model's reasoning, collapsed by default and visually de-emphasised. The label says how long
 * it took; a chat saved before the turn started timing it can only say that it happened.
 */
export function ThinkingBlock({ text, durationMs, live }: { text: string; durationMs?: number; live?: boolean }) {
  return (
    <Disclosure
      // `first:mt-0` so a turn that opens with its reasoning starts flush with the one above it.
      className="my-1 text-sm text-muted-foreground first:mt-0"
      triggerClassName="flex items-center gap-1.5 rounded px-1 py-0.5 transition-colors hover:text-foreground"
      summary={
        <>
          <LightbulbIcon className="size-3.5" />
          {thoughtLabel(durationMs, live)}
        </>
      }
    >
      {/* Reasoning is prose, not code, so it reads as prose: sans-serif, with its line breaks kept. */}
      <div className="mt-1 max-h-64 overflow-auto rounded-lg border border-border bg-muted/40 p-3 text-xs whitespace-pre-wrap">
        {text}
      </div>
    </Disclosure>
  );
}
