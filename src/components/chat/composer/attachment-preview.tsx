"use client";

import { DownloadIcon, Loader2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { errorMessage } from "@/lib/utils";
import { documentState, type MessageDocument } from "../message-attachments";
import { Markdown } from "../markdown";

/**
 * What the agent reads, as the reader can read it: the normalised Markdown the parse produced,
 * fetched from the `/text` route, with the original file a click away. A table comes back as its
 * schema and first rows, because the rows themselves are for the calculator. It is mounted only
 * while open.
 */
export function AttachmentPreview({
  attachment,
  onOpenChange,
}: {
  attachment: MessageDocument;
  onOpenChange: (open: boolean) => void;
}) {
  const { document, textUrl, url } = attachment;
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The text is the parse of a content-addressed file, so it is fetched once and never changes.
  useEffect(() => {
    if (textUrl === undefined || text !== null) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch(textUrl, { signal: controller.signal });
        if (!res.ok) throw new Error(`The text of this file could not be read (${res.status}).`);
        setText(await res.text());
      } catch (err) {
        if (!controller.signal.aborted) setError(errorMessage(err));
      }
    })();
    return () => controller.abort();
  }, [textUrl, text]);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] w-[95vw] max-w-[95vw] flex-col gap-3 sm:max-w-3xl">
        <DialogHeader className="gap-1 pr-8">
          <DialogTitle className="truncate text-base font-medium">{document.name}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span>{documentState(document)}</span>
            {url !== undefined && (
              <a
                href={url}
                download={document.name}
                className="inline-flex items-center gap-1 text-foreground underline-offset-2 hover:underline"
              >
                <DownloadIcon className="size-3" />
                Download original
              </a>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-card p-3">
          {error !== null ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : text === null ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="size-3.5 animate-spin" />
              Loading…
            </p>
          ) : text.trim() === "" ? (
            <p className="text-sm text-muted-foreground">This file has no readable text.</p>
          ) : (
            <Markdown>{text}</Markdown>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
