import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageContent } from "@earendil-works/pi-ai";
import { attachmentUrl, documentTextUrl, extensionOf } from "@/lib/attachments/formats";
import { formatTokens } from "@/components/shared/format";
import type { StoredAttachment, StoredImage } from "@/lib/attachments/types";

/*
 * How a turn's attachments render: the thumbnails and document chips of a message, and the
 * hand-over of the composer's previews when the server's copy of a turn replaces the optimistic
 * one. What the composer holds before a message goes is in ./composer/attachments.ts.
 */

/* ------------------------------------------------------------- documents */

/** One document chip as the transcript renders it. */
export interface MessageDocument {
  /** The turn's own key and the document's position, so the echo swap keeps the same element. */
  key: string;
  document: StoredAttachment;
  /** The original file, as a download; absent until the chat has an id to serve it from. */
  url?: string;
  /** The normalised Markdown the preview dialog reads; absent for the same reason. */
  textUrl?: string;
}

/** The documents of a turn. They sit beside the content blocks, since pi has no document block. */
function documentBlocks(message: AgentMessage): StoredAttachment[] {
  if (message.role === "user" || message.role === "skill") return message.documents ?? [];
  return [];
}

/**
 * The document chips for one turn. A chat that has not been saved yet has no id, so the chips show
 * what the parse found but cannot be opened; the URLs appear with the session the send creates.
 */
export function documentsOfMessage(message: AgentMessage, sessionId: string | null, key: string): MessageDocument[] {
  return documentBlocks(message).map((document, index) => ({
    key: `${key}:d${index}`,
    document,
    ...(sessionId === null
      ? {}
      : { url: attachmentUrl(sessionId, document.attachment), textUrl: documentTextUrl(sessionId, document.attachment) }),
  }));
}

/** What a file's parts are called, by extension; a format that has none says only its size. */
const PART_UNITS: Record<string, [one: string, many: string]> = {
  pdf: ["page", "pages"],
  pptx: ["slide", "slides"],
  csv: ["sheet", "sheets"],
  xlsx: ["sheet", "sheets"],
  xls: ["sheet", "sheets"],
};

const count = new Intl.NumberFormat("en-US");

/** "~8.2k tokens": precise enough to compare two files, vague enough not to be read as a promise. */
function tokenLabel(tokens: number): string {
  return `~${formatTokens(tokens)} tokens`;
}

/**
 * The chip's state line for a parsed document: "12 pages · ~8k tokens", "3 sheets · 4,210 rows",
 * or just the size for a format whose parts have no name of their own. A table is measured in rows
 * rather than tokens, because rows are what it holds and what the calculator will work on.
 */
export function documentState(document: StoredAttachment): string {
  const unit = PART_UNITS[extensionOf(document.name)];
  const parts = unit === undefined ? undefined : `${count.format(document.parts)} ${document.parts === 1 ? unit[0] : unit[1]}`;
  const size =
    document.rows === undefined
      ? tokenLabel(document.tokens)
      : `${count.format(document.rows)} ${document.rows === 1 ? "row" : "rows"}`;
  return [parts, size].filter((piece) => piece !== undefined).join(" · ");
}

/**
 * The neutral note under a chip, for a file the agent will not read in one go: either a parser cap
 * cut the normalised text short, or the text is larger than what fits beside the conversation. Both
 * end the same way — the agent reads it in parts, through `read_attachment` — so they say so once.
 * A table is left out: its rows never ride in the context at all, they go to the calculator.
 */
export function documentNote(document: StoredAttachment, budget?: number): string | undefined {
  const overBudget = document.kind !== "table" && budget !== undefined && document.tokens > budget;
  return document.truncated || overBudget ? "Large file: the agent will read it in parts" : undefined;
}

/* ------------------------------------------------------------- images */

/**
 * One thumbnail as the transcript renders it. Both URLs can be present at once, in the moment
 * between the server saving the file and the browser having fetched it back; the bubble shows the
 * preview until the stored copy has loaded, so nothing blinks.
 */
export interface MessageImage {
  /** Stable across the echo swap, so React keeps the same element and never remounts it. */
  key: string;
  /** Where the saved file is served from; absent until the server has stored it. */
  url?: string;
  /** The composer's object URL, on an optimistic turn and on the echo that replaces it. */
  previewUrl?: string;
  alt: string;
  width?: number;
  height?: number;
}

/**
 * An image block as the transcript may find it: saved by the server, or still optimistic. The
 * fields are all optional because either half may be missing at the moment it is read.
 */
type DisplayImage = ImageContent & {
  attachment?: string;
  width?: number;
  height?: number;
  previewUrl?: string;
};

/** The image blocks of a turn, whichever of the two shapes carries them. */
function imageBlocks(message: AgentMessage): DisplayImage[] {
  if (message.role === "skill") return message.images ?? [];
  if (message.role !== "user" || typeof message.content === "string") return [];
  return message.content.filter((part): part is ImageContent => part.type === "image");
}

/**
 * The thumbnails for one turn. A stored image is fetched from the session's attachment route; an
 * optimistic one has only the object URL the composer made. `key` is the turn's own key and the
 * block's position, because everything else about an image changes the moment the echo lands.
 */
export function imagesOfMessage(message: AgentMessage, sessionId: string | null, key: string): MessageImage[] {
  const blocks = imageBlocks(message);
  const images: MessageImage[] = [];

  blocks.forEach((block, index) => {
    const url = block.attachment && sessionId ? attachmentUrl(sessionId, block.attachment) : undefined;
    if (url === undefined && block.previewUrl === undefined) return;
    images.push({
      key: `${key}:${index}`,
      ...(url === undefined ? {} : { url }),
      ...(block.previewUrl === undefined ? {} : { previewUrl: block.previewUrl }),
      alt: blocks.length > 1 ? `Attached image ${index + 1} of ${blocks.length}` : "Attached image",
      ...(block.width === undefined ? {} : { width: block.width }),
      ...(block.height === undefined ? {} : { height: block.height }),
    });
  });

  return images;
}

/**
 * Put the optimistic turn's object URLs onto the server's copy of it, block for block: the server
 * saves the images in the order they were sent, so position is the only pairing needed. Without
 * this the bubble would go blank at the swap, because the stored URL has never been fetched. The
 * field is client-only and this message is never written back anywhere. Documents need no such
 * hand-over: the server saves the descriptors the composer sent it, under the same names.
 */
export function carryAttachments(optimistic: AgentMessage | undefined, saved: AgentMessage): AgentMessage {
  if (optimistic === undefined) return saved;
  const previews = imageBlocks(optimistic).map((block) => block.previewUrl);
  if (previews.every((url) => url === undefined)) return saved;

  const carry = (block: DisplayImage, index: number): DisplayImage =>
    previews[index] === undefined ? block : { ...block, previewUrl: previews[index] };

  if (saved.role === "skill") {
    return saved.images === undefined ? saved : { ...saved, images: saved.images.map(carry) as StoredImage[] };
  }
  if (saved.role !== "user" || typeof saved.content === "string") return saved;

  // The text block sits among the images, so the images are counted on their own.
  let position = -1;
  return {
    ...saved,
    content: saved.content.map((part) => {
      if (part.type !== "image") return part;
      position += 1;
      return carry(part, position);
    }),
  };
}
