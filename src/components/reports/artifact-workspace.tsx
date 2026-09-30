"use client";

import { type CSSProperties, type ReactNode, type Ref, useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { cn } from "cn";
import { ArtifactGallery } from "./artifact-gallery";
import { type ArtifactView, initialView, reconcile, rememberView } from "./artifact-state";
import { PanelResizeHandle } from "./panel-resize-handle";
import type { ReportRef } from "./report-call";
import { ReportProvider } from "./report-context";
import { ReportPanel } from "./report-panel";
import { usePanelWidth } from "./use-panel-width";
import { useRememberedView } from "./use-remembered-view";

export interface ArtifactWorkspaceHandle {
  /** Bring one report up in the artifact column. */
  open: (id: string) => void;
}

/** What the chat column needs to know about the artifact column beside it. */
export interface ArtifactColumn {
  /** Whether the artifact column is showing, a report or the gallery. */
  panelOpen: boolean;
  /** The way back in: one report goes straight up, several go to the chooser. */
  reopen: () => void;
}

/**
 * A chat's two columns: the conversation, rendered by `children`, and the artifact column with
 * its reports. The column remembers per chat what the reader chose, and its width across chats.
 */
export function ArtifactWorkspace({
  ref,
  sessionId,
  reports,
  children,
}: {
  ref?: Ref<ArtifactWorkspaceHandle>;
  sessionId: string | null;
  reports: ReportRef[];
  children: (column: ArtifactColumn) => ReactNode;
}) {
  /** What the artifact column shows once the reader has said; until then it takes its default. */
  const [chosen, setChosen] = useState<ArtifactView | null>(null);
  const remembered = useRememberedView(sessionId);
  // Derived, so a report that leaves the transcript (after a retry, say) takes the column with it.
  const view = useMemo(
    () => reconcile(chosen ?? initialView(reports, remembered), reports),
    [chosen, remembered, reports],
  );
  const report = view.kind === "report" ? (reports.find((candidate) => candidate.id === view.id) ?? null) : null;
  const { containerRef, containerWidth, width, ratio, setRatio, commitRatio, dragging, setDragging } = usePanelWidth();
  // A row too narrow to hold both columns gives the whole area to the artifact, as below `lg`.
  const splits = width === null || width > 0;

  // Only a choice is worth remembering: the hydration render derives its view before the stored
  // one is readable, and writing that default back would overwrite what the tab had chosen.
  useEffect(() => {
    if (sessionId !== null && chosen !== null) rememberView(sessionId, chosen);
  }, [sessionId, chosen]);

  const openReport = useCallback((id: string) => setChosen({ kind: "report", id }), []);
  const showGallery = useCallback(() => setChosen({ kind: "gallery" }), []);
  const closePanel = useCallback(() => setChosen({ kind: "hidden" }), []);
  const reopen = useCallback(() => setChosen(initialView(reports, null)), [reports]);
  const reportControl = useMemo(() => ({ open: openReport, activeId: report?.id ?? null }), [openReport, report]);
  useImperativeHandle(ref, () => ({ open: openReport }), [openReport]);

  return (
    <ReportProvider value={reportControl}>
      <div ref={containerRef} className="flex h-full min-h-0">
        {/* Below `lg` the artifact column takes the whole area; its close button is the way back. */}
        <div
          className={cn(
            "h-full min-h-0 min-w-0 flex-1 flex-col",
            view.kind === "hidden" ? "flex" : splits ? "hidden lg:flex" : "hidden",
          )}
        >
          {children({ panelOpen: view.kind !== "hidden", reopen })}
        </div>

        {view.kind !== "hidden" && (
          <div
            style={{ "--panel-w": width === null ? "55%" : width > 0 ? `${width}px` : "100%" } as CSSProperties}
            className={cn(
              "relative flex h-full min-h-0 w-full shrink-0 flex-col lg:w-(--panel-w) lg:border-l",
              // The width has to sit under the pointer while it is being dragged, not behind it.
              !dragging && "lg:transition-[width]",
            )}
          >
            {width !== null && width > 0 && containerWidth !== null && (
              <PanelResizeHandle
                width={width}
                containerWidth={containerWidth}
                ratio={ratio}
                onRatioChange={setRatio}
                onCommit={commitRatio}
                dragging={dragging}
                onDraggingChange={setDragging}
              />
            )}

            {report === null ? (
              <ArtifactGallery reports={reports} onOpen={openReport} onClose={closePanel} />
            ) : (
              <ReportPanel
                report={report}
                reports={reports}
                onOpen={openReport}
                onShowGallery={showGallery}
                onClose={closePanel}
              />
            )}
          </div>
        )}
      </div>
    </ReportProvider>
  );
}
