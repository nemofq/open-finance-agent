"use client";

import { Disclosure } from "@/components/shared/disclosure";
import { Badge } from "@/components/ui/badge";
import type { EvidenceEntry, EvidenceKind } from "@/lib/evidence/types";
import { RULE_TITLES } from "@/lib/policy/summary";
import type { CheckRecord, RuleId } from "@/lib/policy/types";
import { type AnswerSummary, disagrees } from "./evidence";
import type { ChatItem } from "./transcript";

type ChecksItem = Extract<ChatItem, { role: "checks" }>;

/** Rules the footer names in its own words. */
const RULE_BADGES: Partial<Record<RuleId, string>> = { P9: "unverified", P11: "flag" };

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * "14 figures · 11 retrieved · 3 computed · 0 unsourced · 1 conflict". The first four are the
 * guarantee the product makes, so they show even at zero; the rest only when there is something.
 */
function countsLine(footer: AnswerSummary): string {
  const counts = [
    plural(footer.figures, "figure"),
    `${footer.retrieved} retrieved`,
    `${footer.computed} computed`,
    `${footer.unsourced} unsourced`,
  ];
  if (footer.assumed > 0) counts.push(`${footer.assumed} assumed`);
  if (footer.conflicts > 0) counts.push(plural(footer.conflicts, "conflict"));
  if (footer.unverified > 0) counts.push(`${footer.unverified} unverified`);
  if (footer.flags.length > 0) counts.push(plural(footer.flags.length, "flag"));
  return counts.join(" · ");
}

/** What the engine's verdict kinds are called for a reader: `annotate` and `serve` are its words. */
const KIND_LABELS: Record<CheckRecord["kind"], string> = {
  annotate: "Note",
  block: "Blocked",
  flag: "Flag",
  follow_up: "Sent back",
  serve: "Reused",
};

/** Only where the id letter does not already say it: `E` is retrieved and `C` is calculated. */
const ENTRY_KINDS: Partial<Record<EvidenceKind, string>> = { A: "assumption", U: "from you", R: "report" };

/** The calculator ends its summaries with "(calculated)", which under a `C` id is said twice. */
function summaryOf(entry: EvidenceEntry): string {
  return entry.kind === "C" ? entry.summary.replace(/\s*\(calculated\)$/, "") : entry.summary;
}

function checkVariant(kind: CheckRecord["kind"]): "secondary" | "destructive" | "outline" {
  if (kind === "block") return "destructive";
  if (kind === "flag") return "secondary";
  return "outline";
}

function EntryRow({ entry }: { entry: EvidenceEntry }) {
  const conflict = disagrees(entry);

  return (
    <li className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
      <Badge variant="outline" className="font-mono">
        {entry.id}
      </Badge>
      <span className="min-w-0 break-words text-foreground">{summaryOf(entry)}</span>
      {ENTRY_KINDS[entry.kind] && <span>{ENTRY_KINDS[entry.kind]}</span>}
      {entry.source && (
        <span>
          {entry.source.name} · tier {entry.source.tier}
        </span>
      )}
      {entry.asOf && <span>as of {entry.asOf}</span>}
      {entry.lookAhead && <Badge variant="secondary">look-ahead</Badge>}
      {conflict && <Badge variant="destructive">conflict</Badge>}
    </li>
  );
}

function CheckRow({ check }: { check: CheckRecord }) {
  const badge = RULE_BADGES[check.rule];

  return (
    <li className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
      <Badge variant={checkVariant(check.kind)}>{KIND_LABELS[check.kind]}</Badge>
      <span className="text-foreground">{RULE_TITLES[check.rule]}</span>
      {badge && <Badge variant="outline">{badge}</Badge>}
      <span className="min-w-0 break-words">{check.reason}</span>
    </li>
  );
}

/**
 * Where every figure under an answer came from, and what the rules made of it.
 * It sits under every answer, so the collapsed line stays as quiet as the surrounding text.
 */
export function AnswerFooter({ item }: { item: ChecksItem }) {
  const { checks, footer } = item;

  if (footer.entries.length === 0 && checks.length === 0) return null;

  return (
    <Disclosure
      className="text-xs text-muted-foreground"
      triggerClassName="flex items-center gap-1.5 rounded px-1 py-0.5 transition-colors hover:text-foreground"
      summary={<span className="tabular-nums">{countsLine(footer)}</span>}
    >
      <div className="mt-1 flex flex-col gap-3 rounded-lg border border-border bg-card p-2.5">
        {footer.entries.length > 0 && (
          <div>
            <p className="mb-1.5 font-medium">Figures</p>
            <ul className="flex flex-col gap-1.5">
              {footer.entries.map((entry) => (
                <EntryRow key={entry.id} entry={entry} />
              ))}
            </ul>
          </div>
        )}
        {checks.length > 0 && (
          <div>
            <p className="mb-1.5 font-medium">Checks</p>
            <ul className="flex flex-col gap-1.5">
              {checks.map((check) => (
                <CheckRow key={check.id} check={check} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </Disclosure>
  );
}
