"use client";

import { useState } from "react";
import { getJson, HttpError, putJson } from "@/components/shared/http-client";
import { SaveButton, SettingsHeader } from "@/components/shared/page-shell";
import { StatusLine } from "@/components/shared/field-row";
import { useJson } from "@/components/shared/use-json";
import { useUnsavedChangesWarning } from "@/components/shared/use-unsaved-changes";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "cn";
import { errorMessage } from "@/lib/utils";

interface MemoryResponse {
  content: string;
  /** The version `content` is; a save sends it back so the server can refuse a stale one. */
  revision: string;
  path: string;
  maxChars: number;
}

/** Settings › Memory: `memory.md` as one document with one Save. */
export function MemorySettings() {
  const loaded = useJson<MemoryResponse>("/api/memory");
  /** The latest save's or reload's reply, which replaces what was loaded. */
  const [saved, setSaved] = useState<MemoryResponse | null>(null);
  /** The user's text; `null` until they type, so it follows what was loaded. */
  const [edited, setEdited] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** Why the last save was refused; the user's text stays in the editor either way. */
  const [refusal, setRefusal] = useState<{ message: string; changed: boolean } | null>(null);
  const stored = saved ?? loaded.data;
  const baseline = stored?.content ?? "";
  const content = edited ?? baseline;
  const dirty = content !== baseline;
  const over = stored ? content.length > stored.maxChars : false;
  useUnsavedChangesWarning(dirty);

  const save = async () => {
    if (!stored) return;
    setSaving(true);
    try {
      const res = await putJson<MemoryResponse>("/api/memory", { content, revision: stored.revision });
      // Only the baseline moves, so anything typed while the request ran stays unsaved.
      setSaved(res);
      setRefusal(null);
      toast.success("Memory saved");
    } catch (err) {
      if (err instanceof HttpError && (err.code === "memory_changed" || err.code === "memory_too_large")) {
        setRefusal({ message: err.message, changed: err.code === "memory_changed" });
      } else {
        toast.error(errorMessage(err));
      }
    } finally {
      setSaving(false);
    }
  };

  /** Loads the latest file into the editor, replacing the user's text; they are told to copy it first. */
  const reload = async () => {
    try {
      setSaved(await getJson<MemoryResponse>("/api/memory"));
      setEdited(null);
      setRefusal(null);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const copy = () => {
    void navigator.clipboard.writeText(content).then(
      () => toast.success("Your text is copied"),
      // A browser that refuses the clipboard leaves the text in the editor to copy by hand.
      () => toast.error("Could not copy; select the text in the editor and copy it by hand."),
    );
  };

  return (
    <div className="space-y-6">
      <SettingsHeader
        title="Memory"
        description="Durable notes the agent reads at the start of every turn. Edit it directly; the agent also appends to it."
      />

      {loaded.error ? <StatusLine ok={false}>{loaded.error}</StatusLine> : null}

      {!stored && !loaded.error ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : (
        <div className="space-y-3">
          <Textarea
            aria-label="Memory contents"
            className="min-h-96 font-mono text-xs"
            value={content}
            spellCheck={false}
            onChange={(event) => setEdited(event.target.value)}
          />
          {refusal ? (
            <div className="space-y-2">
              <StatusLine ok={false}>
                {refusal.message}
                {refusal.changed ? " Copy your text, then reload the latest version and reapply your edits." : null}
              </StatusLine>
              {refusal.changed ? (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={copy}>
                    Copy my text
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void reload()}>
                    Reload latest
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              {stored ? <code className="font-mono text-muted-foreground">{stored.path}</code> : null}
              {stored ? (
                <span className={cn("tabular-nums", over ? "text-destructive" : "text-muted-foreground")}>
                  {content.length.toLocaleString()} / {stored.maxChars.toLocaleString()} characters
                </span>
              ) : null}
            </div>
            <SaveButton dirty={dirty} saving={saving} onClick={() => void save()} />
          </div>
        </div>
      )}
    </div>
  );
}
