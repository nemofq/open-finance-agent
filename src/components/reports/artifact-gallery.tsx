"use client";

import { FileTextIcon, PresentationIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useColorScheme } from "@/components/shared/use-color-scheme";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { templateById } from "@/lib/reports/templates";
import { relativeTime } from "./artifact-state";
import type { ReportRef } from "./report-call";
import { type ReportTheme, reportSrcDoc } from "./report-document";
import { useElementWidth } from "./use-element-width";

/** The width a preview is laid out at before being scaled down to its card. */
const PREVIEW_WIDTH = 800;
/** A deck is previewed as a slide, a document as a page. */
const PREVIEW_ASPECT = { slides: 16 / 10, doc: 4 / 3 };

/** One report as a card: its first page, rendered for real, over what it is and when. */
function GalleryCard({
  report,
  latest,
  now,
  theme,
  onOpen,
}: {
  report: ReportRef;
  latest: boolean;
  now: number;
  theme: ReportTheme;
  onOpen: () => void;
}) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const slides = report.format === "slides";
  const Icon = slides ? PresentationIcon : FileTextIcon;
  const template = templateById(report.template);
  const aspect = slides ? PREVIEW_ASPECT.slides : PREVIEW_ASPECT.doc;

  const srcDoc = useMemo(
    () => reportSrcDoc(report.html, theme, slides ? { format: "slides", slide: 1 } : { format: "doc" }),
    [report.html, theme, slides],
  );

  return (
    <button
      type="button"
      aria-label={`Open report: ${report.title}`}
      onClick={onOpen}
      className="group flex flex-col gap-2 rounded-xl border border-border bg-card p-2 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <div
        ref={ref}
        className="relative overflow-hidden rounded-lg border border-border bg-background"
        style={{ aspectRatio: aspect }}
      >
        {width !== null && (
          <iframe
            // Inert decoration: the card's own button is the control, and the report itself is
            // still untrusted HTML, so the frame stays scriptless and out of the tab order.
            sandbox=""
            srcDoc={srcDoc}
            title=""
            aria-hidden
            tabIndex={-1}
            loading="lazy"
            className="pointer-events-none absolute top-0 left-0 border-0"
            style={{
              width: PREVIEW_WIDTH,
              height: PREVIEW_WIDTH / aspect,
              transform: `scale(${width / PREVIEW_WIDTH})`,
              transformOrigin: "top left",
            }}
          />
        )}
        {latest && (
          <Badge variant="secondary" className="absolute top-1.5 right-1.5 shadow-sm">
            Latest
          </Badge>
        )}
      </div>

      <div className="min-w-0 px-1 pb-0.5">
        <p className="line-clamp-2 text-sm font-medium">{report.title}</p>
        <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <Icon className="size-3 shrink-0" />
          <span className="shrink-0">{slides ? "Slides" : "Document"}</span>
          {template && <span className="truncate">· {template.name}</span>}
          {/* The clock is read at mount, so the markup the server sent may be a moment behind. */}
          <span className="shrink-0" suppressHydrationWarning>
            · {relativeTime(report.createdAt, now)}
          </span>
        </p>
      </div>
    </button>
  );
}

/**
 * Every report of one chat, as a grid of live previews. It is what the column opens on when a
 * chat holds more than one report: the choice is easier made by eye than from a list of titles.
 */
export function ArtifactGallery({
  reports,
  onOpen,
  onClose,
}: {
  reports: ReportRef[];
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const theme = useColorScheme();
  const [now] = useState(Date.now);
  const newest = reports.reduce((latest, report) => (report.createdAt > latest.createdAt ? report : latest), reports[0]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-bar shrink-0 items-center gap-2 border-b bg-background px-3">
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">Reports in this chat</h2>
        <Badge variant="outline" className="shrink-0 tabular-nums">
          {reports.length}
        </Badge>
        <Tooltip>
          <TooltipTrigger
            render={<Button variant="ghost" size="icon-sm" aria-label="Hide reports" onClick={onClose} />}
          >
            <XIcon />
          </TooltipTrigger>
          <TooltipContent>Hide reports</TooltipContent>
        </Tooltip>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4 p-4">
          {reports.map((report) => (
            <GalleryCard
              key={report.id}
              report={report}
              latest={report.id === newest?.id}
              now={now}
              theme={theme}
              onOpen={() => onOpen(report.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
