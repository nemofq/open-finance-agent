"use client";

import {
  FileCodeIcon,
  FileIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  Loader2Icon,
  PresentationIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { extensionOf } from "@/lib/attachments/formats";
import { cn } from "cn";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

/** By extension rather than by kind: a deck and a memo are both `document`, and do not look alike. */
const ICONS: Record<string, Icon> = {
  pdf: FileTextIcon,
  pptx: PresentationIcon,
  csv: FileSpreadsheetIcon,
  xlsx: FileSpreadsheetIcon,
  xls: FileSpreadsheetIcon,
  html: FileCodeIcon,
  htm: FileCodeIcon,
  docx: FileTextIcon,
  doc: FileTextIcon,
  md: FileTextIcon,
  txt: FileTextIcon,
};

export interface DocumentChipProps {
  /** The file name as the user gave it. */
  name: string;
  /** The line under it: "Parsing…", "12 pages · ~8k tokens", or what went wrong. */
  state: string;
  /** A neutral aside for a file the agent will read in parts. */
  note?: string;
  /** The upload is still running: a spinner stands in for the kind icon. */
  parsing?: boolean;
  /** The upload failed, and `state` is the reason. */
  failed?: boolean;
  /** Opens the preview; without it the chip is a plain block rather than a button. */
  onOpen?: () => void;
  /** Takes the document off the next message; only the composer passes it. */
  onRemove?: () => void;
}

/**
 * One attached document, in the composer and under the turn that sent it. One file is one chip,
 * whatever it holds: a 60-page PDF says so on its state line rather than becoming four thumbnails.
 */
export function DocumentChip({ name, state, note, parsing, failed, onOpen, onRemove }: DocumentChipProps) {
  const Kind = ICONS[extensionOf(name)] ?? FileIcon;
  const body = (
    <>
      {parsing ? (
        <Loader2Icon className="size-4 shrink-0 animate-spin text-muted-foreground" />
      ) : failed ? (
        <TriangleAlertIcon className="size-4 shrink-0 text-destructive" />
      ) : (
        <Kind className="size-4 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{name}</span>
        <span className={cn("block truncate text-xs", failed ? "text-destructive" : "text-muted-foreground")}>
          {state}
        </span>
        {note !== undefined && <span className="block truncate text-xs text-muted-foreground">{note}</span>}
      </span>
    </>
  );

  return (
    <div className="relative flex max-w-64 min-w-0 items-center">
      {onOpen === undefined ? (
        <span className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-card px-2 py-1.5">
          {body}
        </span>
      ) : (
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Preview ${name}`}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-card px-2 py-1.5 text-left hover:bg-muted/50"
        >
          {body}
        </button>
      )}
      {onRemove !== undefined && (
        <button
          type="button"
          aria-label={`Remove ${name}`}
          onClick={onRemove}
          className="absolute -top-1.5 -right-1.5 rounded-full border border-border bg-background p-0.5 text-foreground hover:bg-muted"
        >
          <XIcon className="size-3" />
        </button>
      )}
    </div>
  );
}
