"use client";

import { FileTextIcon, Loader2Icon, PresentationIcon, TriangleAlertIcon } from "lucide-react";
import { Disclosure } from "@/components/shared/disclosure";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { templateById } from "@/lib/reports/templates";
import { cn } from "cn";
import { type ReportCall, reportOf, reportTitleOf } from "./report-call";
import { useActiveReportId, useOpenReport } from "./report-context";

/** The validator's rejection, split into the count it opens with and the problems it lists. */
interface Rejection {
  count: number;
  problems: string[];
}

const COUNT_LINE = /^The report was not created: (\d+) problems? to fix\.$/;
const PROBLEM_LINE = /^\d+\.\s+(.+)$/;

/**
 * Read `formatIssues` back: a count line, the numbered problems, then the instruction the model
 * acted on. `null` for anything else, which the card then shows as the plain error it is.
 */
function rejectionOf(result: string | undefined): Rejection | null {
  if (result === undefined) return null;
  const [first, ...rest] = result.split("\n");
  const count = COUNT_LINE.exec(first.trim());
  if (count === null) return null;
  const problems = rest.flatMap((line) => {
    const problem = PROBLEM_LINE.exec(line.trim());
    // The validator caps the list and says how many it left out; that line belongs with them.
    if (problem === null) return line.trim().startsWith("…and") ? [line.trim()] : [];
    return [problem[1]];
  });
  return problems.length === 0 ? null : { count: Number(count[1]), problems };
}

/** Collapsible summary of report rejection errors. */
function RejectionNote({ rejection }: { rejection: Rejection }) {
  const parts = ["Report rejected", `${rejection.count} problem${rejection.count === 1 ? "" : "s"} to fix`];

  return (
    <div className="text-xs">
      <p className="flex items-start gap-1.5 text-destructive/80">
        <TriangleAlertIcon className="mt-0.5 size-3 shrink-0" />
        <span className="min-w-0 break-words">{parts.join(" · ")}</span>
      </p>
      <Disclosure
        triggerClassName="mt-0.5 flex items-center gap-1 rounded text-muted-foreground transition-colors hover:text-foreground [&>svg]:size-3"
        summary={(open) => (open ? "Hide problems" : "Show problems")}
      >
        <ul className="mt-1 flex max-h-64 list-disc flex-col gap-1 overflow-auto rounded-lg border border-border bg-muted/40 py-2 pr-2 pl-6 text-muted-foreground">
          {rejection.problems.map((problem) => (
            <li key={problem} className="min-w-0 break-words">
              {problem}
            </li>
          ))}
        </ul>
      </Disclosure>
    </div>
  );
}

/**
 * The transcript stand-in for a `create_report` call: its title, state, and a way back to it.
 * Once the report exists the whole card opens it, with the Open button as the focusable control.
 */
export function ReportCard({ part }: { part: ReportCall }) {
  const openReport = useOpenReport();
  const activeId = useActiveReportId();
  const report = reportOf(part);
  const running = part.result === undefined;
  const slides = report?.format === "slides";
  const Icon = slides ? PresentationIcon : FileTextIcon;
  const clickable = report !== null && openReport !== null;
  const shown = report !== null && report.id === activeId;
  const template = templateById(report?.template);
  const rejection = part.isError ? rejectionOf(part.result) : null;

  const body = (
    <>
      <Icon className="size-4 shrink-0 text-muted-foreground" />

      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium">{report?.title ?? reportTitleOf(part.args)}</span>
          {template && (
            <Badge variant="outline" className="shrink-0">
              {template.name}
            </Badge>
          )}
          {slides && (
            <Badge variant="outline" className="shrink-0">
              <PresentationIcon />
              slides
            </Badge>
          )}
        </p>
        {running && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2Icon className="size-3 animate-spin" />
            Building report…
          </p>
        )}
        {part.isError &&
          (rejection === null ? (
            <p className="flex items-start gap-1.5 text-xs text-destructive">
              <TriangleAlertIcon className="mt-0.5 size-3 shrink-0" />
              <span className="min-w-0 break-words">{part.result || "The report could not be created."}</span>
            </p>
          ) : (
            <RejectionNote rejection={rejection} />
          ))}
        {!running && !part.isError && !report && (
          <p className="text-xs text-muted-foreground">This report is no longer available.</p>
        )}
      </div>

      {clickable && (
        <Button
          variant="outline"
          size="sm"
          aria-label={`${shown ? "Viewing" : "View"} report: ${report.title}`}
          onClick={(event) => {
            event.stopPropagation(); // the card's own click handler would open it a second time
            openReport(report.id);
          }}
        >
          {shown ? "Viewing" : "View"}
        </Button>
      )}
    </>
  );

  const frame = cn(
    "my-2 flex gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 text-sm",
    // A rejection runs to several lines, so the icon and button sit at the top rather than centred.
    rejection === null ? "items-center" : "items-start",
  );

  if (!clickable) return <div className={frame}>{body}</div>;
  // A div rather than a button so the View button inside stays valid markup; it is the keyboard path.
  return (
    <div
      onClick={() => openReport(report.id)}
      // `aria-current` rather than a visual-only ring: the card is the transcript's marker for
      // what the column is showing.
      aria-current={shown ? "true" : undefined}
      className={cn(frame, "cursor-pointer transition-colors hover:bg-muted/50", shown && "ring-1 ring-ring")}
    >
      {body}
    </div>
  );
}
