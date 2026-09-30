"use client";

import { FileClockIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Disclosure } from "@/components/shared/disclosure";
import type { CheckRecord } from "@/lib/policy/types";

/** What the harness sent the answer back for, said the way the reader sees it happen. */
function label(check: CheckRecord): string {
  if (check.rule === "H1") return "Answer cut off, asked again";
  const figures = check.figures?.length ?? 0;
  if (check.rule === "P8" && figures > 0) {
    return `Draft answer, revised: ${figures} figure${figures === 1 ? "" : "s"} had no evidence entry`;
  }
  return `Draft answer, revised: ${check.reason}`;
}

/**
 * An answer a rule sent back for revision, in the same collapsed, de-emphasised shape as the
 * model's reasoning: what stands is the revision below it, and this is how it got there.
 */
export function DraftBlock({ check, children }: { check: CheckRecord; children: ReactNode }) {
  // The engine falls back to the reason when a rule queues a follow-up without its own prompt.
  const instruction = check.text ?? check.reason;

  return (
    <Disclosure
      className="my-2 text-sm text-muted-foreground"
      triggerClassName="flex items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:text-foreground"
      summary={
        <>
          <FileClockIcon className="size-3.5 shrink-0" />
          {label(check)}
        </>
      }
    >
      <div className="mt-1 max-h-96 overflow-auto rounded-lg border border-border bg-muted/40 p-3 text-xs">
        {children}
        <p className="mt-2 border-t border-border pt-2 whitespace-pre-wrap">
          <span className="font-medium">Harness:</span> {instruction}
        </p>
      </div>
    </Disclosure>
  );
}
