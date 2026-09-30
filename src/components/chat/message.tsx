"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Clock3Icon } from "lucide-react";
import type { EvidenceEntry } from "@/lib/evidence/types";
import { cn } from "cn";
import { AnswerFooter } from "./answer-footer";
import { AttachmentPreview } from "./composer/attachment-preview";
import { documentNote, documentState, type MessageDocument, type MessageImage } from "./message-attachments";
import { CompactionDivider } from "./compaction-divider";
import { DocumentChip } from "./composer/document-chip";
import { DraftBlock } from "./draft-block";
import { Markdown } from "./markdown";
import { fillChatReferences } from "./references";
import { ReportCard } from "@/components/reports/report-card";
import { withTickerChips } from "@/components/market/ticker-chip";
import { ThinkingBlock } from "./thinking-block";
import { ToolCallCard } from "./tool-call-card";
import { type ChatItem, isReportPart, type MessagePart } from "./transcript";

/** One streamed piece of a turn, in the answer itself or inside the draft it was revised from. */
function renderPart(part: MessagePart, index: number, entries: EvidenceEntry[] = [], live = false) {
  if (part.kind === "thinking")
    return <ThinkingBlock key={index} text={part.text} durationMs={part.durationMs} live={live} />;
  if (part.kind === "tool")
    return isReportPart(part) ? <ReportCard key={part.id} part={part} /> : <ToolCallCard key={part.id} part={part} />;
  // A model often streams a bare newline before a tool call; that part has nothing to show.
  if (!part.text.trim()) return null;
  // The model writes report-style `{C17}` references in prose too, where nothing else fills them in.
  return <Markdown key={index}>{fillChatReferences(part.text, entries)}</Markdown>;
}

/** An answer's or a draft's parts, with its ledger entries so references resolve. */
function renderParts(item: Extract<ChatItem, { role: "assistant" | "draft" }>) {
  // Reasoning is still running only while it is the last part of a turn that is still streaming.
  const growing = item.role === "assistant" && item.streaming === true ? item.parts.length - 1 : -1;
  return item.parts.map((part, index) => renderPart(part, index, item.entries, index === growing));
}

/**
 * One attached image, linked to the full picture. A turn that was just sent has both a local
 * object URL and, the moment the server echoes it back, the URL the saved file is served from.
 * Switching straight to the stored URL would blank the thumbnail until it downloaded, so the
 * preview stays on screen and the stored copy is loaded out of sight first.
 */
function Thumbnail({ image, single }: { image: MessageImage; single: boolean }) {
  const { url, previewUrl } = image;
  /** Which stored URL has finished downloading; holding the URL rather than a flag means a new one
   *  starts the wait over on its own, with no state to reset. */
  const [ready, setReady] = useState<string | null>(null);
  /** A preview object URL is revoked once the turn settles; if that races us, take the real one. */
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (url === undefined || previewUrl === undefined) return;
    const preload = new window.Image();
    preload.onload = () => setReady(url);
    preload.src = url;
    return () => {
      preload.onload = null;
    };
  }, [url, previewUrl]);

  const src = previewUrl !== undefined && ready !== url && !failed ? previewUrl : (url ?? previewUrl);
  if (src === undefined) return null;

  return (
    <a
      href={url ?? src}
      target="_blank"
      rel="noreferrer"
      className={cn("block overflow-hidden", single ? "rounded-xl" : "rounded-lg")}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- these are the session's own
          uploads, served from an API route or still an object URL; neither can be optimized. */}
      <img
        src={src}
        alt={image.alt}
        loading="lazy"
        width={image.width}
        height={image.height}
        onError={() => setFailed(true)}
        // Single image displays full-size; multiple images display in square grid.
        className={single ? "h-auto max-h-60 w-auto max-w-80" : "size-32 object-cover"}
      />
    </a>
  );
}

/**
 * What the user attached. A lone image keeps its aspect ratio; two to four tile into a 2×2 grid,
 * so four make a neat block and two make one row.
 */
function Attachments({ images }: { images: MessageImage[] }) {
  const single = images.length === 1;
  return (
    <div className={single ? "flex" : "grid grid-cols-2 gap-1"}>
      {images.map((image) => (
        <Thumbnail key={image.key} image={image} single={single} />
      ))}
    </div>
  );
}

/**
 * The documents a turn carried, each opening the parse the agent reads. A chat whose id the
 * transcript does not know yet — the moment between a first send and the session it creates —
 * has nothing to fetch, so those chips are shown but not opened.
 */
function Documents({ documents }: { documents: MessageDocument[] }) {
  const [previewed, setPreviewed] = useState<MessageDocument | null>(null);

  return (
    <div className="flex flex-col gap-1.5">
      {documents.map((entry) => (
        <DocumentChip
          key={entry.key}
          name={entry.document.name}
          state={documentState(entry.document)}
          note={documentNote(entry.document)}
          onOpen={entry.textUrl === undefined ? undefined : () => setPreviewed(entry)}
        />
      ))}
      {previewed !== null && (
        <AttachmentPreview
          attachment={previewed}
          onOpenChange={(open) => {
            if (!open) setPreviewed(null);
          }}
        />
      )}
    </div>
  );
}

/** The skill chip and the scheduled marker, which sit ahead of whatever the user typed. */
function UserBadges({ item }: { item: Extract<ChatItem, { role: "user" }> }) {
  return (
    <>
      {item.skill && (
        <Badge variant="outline" className="font-mono">
          /{item.skill}
        </Badge>
      )}
      {item.scheduled && (
        <Badge variant="outline" className="gap-1">
          <Clock3Icon className="size-3" /> Scheduled
        </Badge>
      )}
    </>
  );
}

export function Message({ item }: { item: ChatItem }) {
  if (item.role === "user") {
    if (item.images || item.documents) {
      const said = item.text !== "" || item.skill !== undefined || item.scheduled === true;
      return (
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-2xl bg-secondary p-1.5 text-sm text-secondary-foreground">
            {item.images && <Attachments images={item.images} />}
            {item.documents && (
              <div className={cn(item.images && "mt-1.5")}>
                <Documents documents={item.documents} />
              </div>
            )}
            {said && (
              <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 px-2 pb-1 whitespace-pre-wrap">
                <UserBadges item={item} />
                {item.text && <span className="min-w-0 break-words">{withTickerChips(item.text)}</span>}
              </div>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="flex justify-end">
        <div className="flex max-w-[85%] flex-wrap items-baseline gap-x-2 gap-y-1 rounded-2xl bg-secondary px-3.5 py-2 text-sm whitespace-pre-wrap text-secondary-foreground">
          <UserBadges item={item} />
          {item.text && <span className="min-w-0 break-words">{withTickerChips(item.text)}</span>}
        </div>
      </div>
    );
  }

  if (item.role === "checks") return <AnswerFooter item={item} />;

  if (item.role === "compaction") return <CompactionDivider compaction={item.compaction} />;

  if (item.role === "draft") return <DraftBlock check={item.check}>{renderParts(item)}</DraftBlock>;

  return <div className="w-full text-sm tabular-nums">{renderParts(item)}</div>;
}
