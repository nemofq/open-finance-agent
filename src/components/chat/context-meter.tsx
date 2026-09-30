"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { ContextUsage } from "@/lib/context/types";
import { cn } from "cn";
import { formatTokens } from "@/components/shared/format";

/** Old results start being stubbed at half the window, and compaction fires at three quarters. */
const STUB_SHARE = 0.5;
const COMPACT_SHARE = 0.75;

function barColor(share: number): string {
  if (share >= COMPACT_SHARE) return "bg-destructive";
  if (share >= STUB_SHARE) return "bg-amber-500";
  return "bg-muted-foreground/60";
}

/**
 * How full the model's context is. Nothing is persisted: the meter follows the
 * `context` events of the running turn and disappears with the page.
 */
export function ContextMeter({ usage }: { usage: ContextUsage }) {
  const share = usage.window > 0 ? Math.min(usage.used / usage.window, 1) : 0;
  const percent = Math.round(share * 100);

  return (
    <span className="flex items-center gap-1.5">
      <span
        role="progressbar"
        aria-label="Context used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent}% of the model's context used`}
        title={
          usage.compactions > 0
            ? `${percent}% of the context window used, after ${usage.compactions} compaction${usage.compactions > 1 ? "s" : ""}`
            : `${percent}% of the context window used`
        }
        className="h-1 w-10 overflow-hidden rounded-full bg-border"
      >
        <span className={cn("block h-full rounded-full transition-[width]", barColor(share))} style={{ width: `${percent}%` }} />
      </span>
      <span className="tabular-nums">
        {formatTokens(usage.used)} / {formatTokens(usage.window)}
      </span>
      {usage.unknownWindow && (
        <Link href="/settings/llm" aria-label="Set this model's context window in LLM settings">
          <Badge variant="outline" className="font-normal">
            window assumed {formatTokens(usage.window)} — set it in Settings › LLM
          </Badge>
        </Link>
      )}
    </span>
  );
}
