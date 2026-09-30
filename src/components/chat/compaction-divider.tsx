"use client";

import { ScissorsIcon } from "lucide-react";
import { Disclosure } from "@/components/shared/disclosure";
import { Badge } from "@/components/ui/badge";
import type { CompactionMessage } from "@/lib/context/types";
import { formatTokens } from "@/components/shared/format";

/**
 * Where the model's context was replaced by a research checkpoint. The history above
 * it stays on screen; this marks what the model itself still sees from here on.
 */
export function CompactionDivider({ compaction }: { compaction: CompactionMessage }) {
  return (
    <Disclosure
      className="text-xs text-muted-foreground"
      triggerClassName="flex w-full items-center gap-2 transition-colors hover:text-foreground"
      summary={
        <>
          {/* Ordered ahead of the chevron, so the label sits between two rules. */}
          <span className="-order-1 h-px flex-1 bg-border" />
          <ScissorsIcon className="size-3.5 shrink-0" />
          Context compacted
          <span className="tabular-nums">
            {formatTokens(compaction.tokensBefore)} → {formatTokens(compaction.tokensAfter)}
          </span>
          <span className="h-px flex-1 bg-border" />
        </>
      }
    >
      <div className="mt-2 flex flex-col gap-2 rounded-lg border border-border bg-card p-2.5">
        {compaction.focus && (
          <p>
            <span className="font-medium">Focus:</span> {compaction.focus}
          </p>
        )}
        <pre className="max-h-64 overflow-auto rounded border border-border bg-muted/40 p-2 font-mono whitespace-pre-wrap">
          {compaction.summary}
        </pre>
        {compaction.evidenceIds.length > 0 && (
          <p className="flex flex-wrap items-center gap-1">
            <span className="font-medium">Evidence kept:</span>
            {compaction.evidenceIds.map((id) => (
              <Badge key={id} variant="outline" className="font-mono">
                {id}
              </Badge>
            ))}
          </p>
        )}
        {compaction.stripped && compaction.stripped.length > 0 && (
          <p className="text-destructive">
            Stripped, no entry held them: {compaction.stripped.join(", ")}
          </p>
        )}
      </div>
    </Disclosure>
  );
}
