"use client";

import { ArrowUpIcon, PaperclipIcon, SquareIcon, XIcon } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { accept } from "@/lib/attachments/formats";
import { documentNote, documentState } from "../message-attachments";
import { filesFromClipboard, filesFromDataTransfer, isParsing } from "./attachments";
import { DocumentChip } from "./document-chip";
import type { ComposerState } from "./use-composer";

/** Combobox wiring for the `$` and `/` popovers rendered into `slot`. */
export interface ComposerInputAria {
  "aria-expanded": boolean;
  "aria-controls"?: string;
  "aria-activedescendant"?: string;
}

/** What the chat around the composer decides: the turn's state and the footer's slots. */
export interface ComposerTurnProps {
  streaming: boolean;
  onStop: () => void;
  /** Blocks sending (button and Enter) while typing stays possible, e.g. until a model is chosen. */
  sendDisabled: boolean;
  /** How much of the conversation one document may be inlined into, for the large-file note. */
  budget: number | undefined;
  /** The chat's model, as a picker or a fixed label, shown in the footer. */
  modelSlot: ReactNode;
  /** The context meter, shown in the footer beside the model. */
  contextSlot: ReactNode;
}

export interface ComposerProps extends ComposerTurnProps {
  /**
   * The draft, its skill and attachments, and what to do with them: `useComposer`'s state. Every
   * picked, dropped or pasted file goes to `addFiles`, which knows this chat's model and limits
   * and so can say why a file was turned away.
   */
  composer: ComposerState;
  /** Receives the caret offset so `$` autocomplete can locate the fragment being typed. */
  onValueChange: (value: string, caret: number) => void;
  /** Called before the composer's own key handling. Return true to consume the event. */
  onKeyDownCapture: (event: KeyboardEvent<HTMLTextAreaElement>, value: string) => boolean;
  /** Overlay anchored above the input, for the autocomplete and picker popovers. */
  slot: ReactNode;
  /**
   * Called on a pointerdown outside the input card and its popover, so an open menu closes like any
   * other. Pass it only while a menu is open; controls that toggle one opt out with
   * `data-composer-toggle`.
   */
  onDismiss?: () => void;
  /** Extra controls in the footer, such as the skills button. */
  footerActions: ReactNode;
  inputAria: ComposerInputAria;
}

const MAX_HEIGHT = 200;

/** True while the pointer carries files, as opposed to dragged text or a link. */
function draggingFiles(data: DataTransfer | null): boolean {
  return data !== null && [...data.types].includes("Files");
}

export function Composer({
  composer,
  onValueChange,
  onStop,
  streaming,
  sendDisabled,
  modelSlot,
  contextSlot,
  onKeyDownCapture,
  slot,
  onDismiss,
  budget,
  footerActions,
  inputAria,
}: ComposerProps) {
  const { draft: value, skill, images: attachedImages, documents: attachedDocuments, addFiles, textareaRef: ref } = composer;
  const cardRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  /**
   * Dragging over a child fires `dragleave` on the parent, so counting enter against leave is the
   * only way to keep the overlay steady while the pointer crosses the textarea and the buttons.
   */
  const depth = useRef(0);
  // Read through a ref so a fresh inline callback does not re-subscribe on every keystroke.
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  });

  const attached = attachedImages.length + attachedDocuments.length;
  /** A document that is still being read cannot be sent, so the whole turn waits for it. */
  const parsing = attachedDocuments.some(isParsing);
  /** A document that failed is shown until it is removed, but it is not something to send. */
  const sendable = attachedImages.length + attachedDocuments.filter((entry) => entry.error === undefined).length;
  const nothingToSend = !value.trim() && !skill && sendable === 0;

  const dismissable = onDismiss !== undefined;
  useEffect(() => {
    if (!dismissable) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      if (cardRef.current?.contains(target)) return;
      if (target.closest("[data-composer-toggle]")) return;
      dismissRef.current?.();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [dismissable]);

  // Grow with the content up to a cap, then scroll.
  useEffect(() => {
    const textarea = ref.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_HEIGHT)}px`;
  }, [ref, value]);

  function submit() {
    if (nothingToSend || streaming || sendDisabled || parsing) return;
    // Emptied here as well, so the menus' caret goes back to the start with the draft: a turn put
    // back after a refused image must not reopen the `$` menu at its end.
    onValueChange("", 0);
    void composer.submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (onKeyDownCapture(event, value)) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = filesFromClipboard(event.clipboardData);
    if (files.length === 0) return;
    // A pasted screenshot also carries a placeholder text flavour; keep it out of the draft.
    event.preventDefault();
    addFiles(files);
  }

  function handleDragEnter(event: DragEvent<HTMLDivElement>) {
    if (!draggingFiles(event.dataTransfer)) return;
    depth.current += 1;
    setDragging(true);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (!draggingFiles(event.dataTransfer)) return;
    // Without this the browser navigates to the dropped file instead of handing it over.
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave() {
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDragging(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (!draggingFiles(event.dataTransfer)) return;
    event.preventDefault();
    depth.current = 0;
    setDragging(false);
    const files = filesFromDataTransfer(event.dataTransfer);
    if (files.length > 0) addFiles(files);
  }

  function handlePicked(files: FileList | null) {
    if (files && files.length > 0) addFiles([...files]);
    // Reset, so picking the same file twice in a row still fires a change event.
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    // As tall as the sidebar's foot block, so the two top borders meet across the columns.
    <div className="min-h-foot border-t bg-background">
      <div className="mx-auto w-full max-w-3xl px-4 py-3">
        <div ref={cardRef} className="relative">
          {slot}
          <div
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className="relative rounded-2xl border border-border bg-card p-2 focus-within:border-ring"
          >
            {dragging && (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl border border-dashed border-ring bg-card/90 px-3 text-center text-sm text-muted-foreground">
                Drop images, documents or spreadsheets to attach
              </div>
            )}
            {skill && (
              <div className="mb-1 flex px-1">
                <Badge variant="secondary" className="gap-1 pr-1 font-mono">
                  /{skill}
                  <button
                    type="button"
                    aria-label={`Remove skill ${skill}`}
                    onClick={() => composer.setSkill(undefined)}
                    className="rounded-full p-0.5 hover:bg-foreground/10"
                  >
                    <XIcon className="size-3" />
                  </button>
                </Badge>
              </div>
            )}
            {attached > 0 && (
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5 px-1">
                {attachedImages.map((image) => (
                  <div key={image.id} className="relative size-14 overflow-hidden rounded-md border border-border">
                    {/* eslint-disable-next-line @next/next/no-img-element -- an object URL for a file
                        the server has never seen; there is nothing for the image optimizer to fetch. */}
                    <img src={image.previewUrl} alt={image.file.name} className="size-full object-cover" />
                    <button
                      type="button"
                      aria-label={`Remove image ${image.file.name}`}
                      onClick={() => composer.removeImage(image.id)}
                      className="absolute top-0.5 right-0.5 rounded-full bg-background/80 p-0.5 text-foreground hover:bg-background"
                    >
                      <XIcon className="size-3" />
                    </button>
                  </div>
                ))}
                {attachedImages.length > 1 && (
                  <span className="text-xs tabular-nums text-muted-foreground">{attachedImages.length} images</span>
                )}
                {attachedDocuments.map((entry) => (
                  <DocumentChip
                    key={entry.id}
                    name={entry.name}
                    state={
                      entry.error ??
                      (entry.document === undefined ? "Parsing…" : documentState(entry.document))
                    }
                    note={entry.document === undefined ? undefined : documentNote(entry.document, budget)}
                    parsing={isParsing(entry)}
                    failed={entry.error !== undefined}
                    onRemove={() => composer.removeDocument(entry.id)}
                  />
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <Textarea
                ref={ref}
                rows={1}
                value={value}
                onChange={(event) =>
                  onValueChange(event.target.value, event.target.selectionStart ?? event.target.value.length)
                }
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder="Ask about a company, filing or earnings print…"
                aria-label="Message"
                role="combobox"
                aria-autocomplete="list"
                {...inputAria}
                className="max-h-[200px] min-h-8 flex-1 resize-none border-0 bg-transparent py-1.5 shadow-none focus-visible:ring-0"
              />
              {streaming ? (
                <Button variant="outline" size="icon" aria-label="Stop generating" onClick={onStop}>
                  <SquareIcon />
                </Button>
              ) : (
                <Button
                  size="icon"
                  aria-label="Send message"
                  disabled={nothingToSend || sendDisabled || parsing}
                  onClick={submit}
                >
                  <ArrowUpIcon />
                </Button>
              )}
            </div>
          </div>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-xs text-muted-foreground">
          {footerActions}
          <input
            ref={fileRef}
            type="file"
            accept={accept}
            multiple
            className="hidden"
            onChange={(event) => handlePicked(event.target.files)}
          />
          {/* Never disabled: a document reaches any model as text, and a picture on a model that
              cannot see one is turned away file by file, with the reason. */}
          <Button variant="ghost" size="xs" onClick={() => fileRef.current?.click()}>
            <PaperclipIcon data-icon="inline-start" />
            Attach
          </Button>
          {modelSlot}
          {contextSlot}
          <span className="ml-auto hidden sm:inline">Enter to send · Shift+Enter for a new line</span>
        </div>
      </div>
    </div>
  );
}
