"use client";

import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileTextIcon,
  LayoutGridIcon,
  PresentationIcon,
  XIcon,
} from "lucide-react";
import { type KeyboardEvent, type ReactNode, useMemo, useState } from "react";
import { useColorScheme } from "@/components/shared/use-color-scheme";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { relativeTime, reportFileName } from "./artifact-state";
import type { ReportRef } from "./report-call";
import { countSlides, reportSrcDoc } from "./report-document";

interface ReportPanelProps {
  report: ReportRef;
  /** Every report of the chat, for the title dropdown's quick switch. */
  reports: ReportRef[];
  onOpen: (id: string) => void;
  onShowGallery: () => void;
  onClose: () => void;
}

/** The title as a switch between this chat's reports, each with what it is and when it was made. */
function ReportSwitch({ report, reports, onOpen }: Pick<ReportPanelProps, "report" | "reports" | "onOpen">) {
  const [now] = useState(Date.now);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="sm" className="min-w-0 flex-1 justify-start gap-1 px-1.5" />}
      >
        <h2 className="min-w-0 truncate text-sm font-medium">{report.title}</h2>
        <ChevronDownIcon className="shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-auto max-w-sm min-w-72">
        <DropdownMenuRadioGroup value={report.id} onValueChange={(id: string) => onOpen(id)}>
          {reports.map((candidate) => {
            const Icon = candidate.format === "slides" ? PresentationIcon : FileTextIcon;
            return (
              <DropdownMenuRadioItem key={candidate.id} value={candidate.id} closeOnClick>
                <span className="w-4 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {candidate.ordinal}
                </span>
                <Icon className="shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{candidate.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {relativeTime(candidate.createdAt, now)}
                </span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** An icon-only control that says what it does on hover as well as to a screen reader. */
function IconAction({ label, icon, onClick }: { label: string; icon: ReactNode; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick} />}>
        {icon}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** The report beside the transcript, isolated in a scriptless, cross-origin iframe. */
export function ReportPanel({ report, reports, onOpen, onShowGallery, onClose }: ReportPanelProps) {
  const theme = useColorScheme();
  const slides = report.format === "slides";

  const [slide, setSlide] = useState(1);
  const [shownId, setShownId] = useState(report.id);
  // Opening another report resets the deck, without the render-then-effect flash.
  if (shownId !== report.id) {
    setShownId(report.id);
    setSlide(1);
  }

  const sections = useMemo(() => countSlides(report.html), [report.html]);
  // At least one, so an empty or still-streaming deck stays on a sane "1 / 1".
  const total = Math.max(1, sections);
  const current = Math.min(slide, total);

  const srcDoc = useMemo(
    () => reportSrcDoc(report.html, theme, slides ? { format: "slides", slide: current } : { format: "doc" }),
    [report.html, theme, slides, current],
  );

  const goTo = (next: number) => setSlide(Math.min(Math.max(next, 1), total));

  /**
   * The report as one standalone file. Neither a new tab nor a saved file has a pager, so a deck
   * goes out with every slide laid out to print.
   */
  const asBlobUrl = (): string => {
    const printable = reportSrcDoc(report.html, theme, slides ? { format: "slides", print: true } : { format: "doc" });
    return URL.createObjectURL(new Blob([printable], { type: "text/html" }));
  };

  /** The reader has the bytes by now; holding the URL any longer would leak it. */
  const release = (url: string) => setTimeout(() => URL.revokeObjectURL(url), 1000);

  const openInTab = () => {
    const url = asBlobUrl();
    window.open(url, "_blank", "noopener,noreferrer");
    release(url);
  };

  const download = () => {
    const url = asBlobUrl();
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${reportFileName(report.title)}.html`;
    anchor.click();
    release(url);
  };

  /**
   * Paging keys, which only reach us while the panel itself has focus: the iframe is
   * cross-origin, so keys pressed inside it are invisible to the host. Hence the buttons.
   */
  const onKeyDown = (event: KeyboardEvent) => {
    if (!slides) return;
    const move: Record<string, number> = {
      ArrowLeft: current - 1,
      PageUp: current - 1,
      ArrowRight: current + 1,
      PageDown: current + 1,
      Home: 1,
      End: total,
    };
    const next = move[event.key];
    if (next === undefined) return;
    event.preventDefault();
    goTo(next);
  };

  return (
    <section
      aria-label="Report"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="flex h-full min-h-0 w-full flex-col outline-none"
    >
      <header className="flex h-bar shrink-0 items-center gap-1 border-b bg-background px-2">
        <ReportSwitch report={report} reports={reports} onOpen={onOpen} />

        <Badge variant="outline" className="shrink-0">
          {slides ? <PresentationIcon /> : <FileTextIcon />}
          {slides ? "slides" : "doc"}
        </Badge>

        {slides && (
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Previous slide"
              disabled={current <= 1}
              onClick={() => goTo(current - 1)}
            >
              <ChevronLeftIcon />
            </Button>
            <span aria-live="polite" className="min-w-12 text-center text-xs tabular-nums text-muted-foreground">
              {current} / {total}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Next slide"
              disabled={current >= total}
              onClick={() => goTo(current + 1)}
            >
              <ChevronRightIcon />
            </Button>
          </div>
        )}

        {/* With a single report the gallery would only show that same card. */}
        {reports.length > 1 && (
          <IconAction label="All reports" icon={<LayoutGridIcon />} onClick={onShowGallery} />
        )}
        <IconAction label="Open in new tab" icon={<ExternalLinkIcon />} onClick={openInTab} />
        <IconAction label="Download HTML" icon={<DownloadIcon />} onClick={download} />
        <IconAction label="Hide reports" icon={<XIcon />} onClick={onClose} />
      </header>

      {slides && (
        <div className="h-0.5 shrink-0 bg-border">
          <div className="h-full bg-primary transition-[width]" style={{ width: `${(current / total) * 100}%` }} />
        </div>
      )}

      <iframe sandbox="" srcDoc={srcDoc} title={report.title} className="min-h-0 w-full flex-1 bg-background" />
    </section>
  );
}
