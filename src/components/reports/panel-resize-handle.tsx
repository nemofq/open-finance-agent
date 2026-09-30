"use client";

import { type KeyboardEvent, type PointerEvent, useCallback, useEffect, useRef } from "react";
import { cn } from "cn";
import { clampPanelRatio } from "./artifact-state";

/** One arrow press, as a share of the row. */
const STEP = 0.02;

interface PanelResizeHandleProps {
  /** The panel's rendered width, which is what a drag moves from. */
  width: number;
  /** The row's width, so a pixel delta becomes a share of it. */
  containerWidth: number;
  ratio: number;
  onRatioChange: (ratio: number) => void;
  /** The gesture is over: the caller may keep this split for next time. */
  onCommit: (ratio: number) => void;
  onDraggingChange: (dragging: boolean) => void;
  dragging: boolean;
}

interface Drag {
  element: HTMLDivElement;
  pointer: number;
  /** Where the pointer went down, and the widths as they were then. */
  originX: number;
  base: number;
  row: number;
}

/**
 * The split between the transcript and the artifact column, grabbed on the panel's left border.
 * Pointer capture keeps the drag alive over the iframe, which would otherwise swallow the moves,
 * and one rAF per frame keeps the width from being set faster than it can be painted.
 */
export function PanelResizeHandle({
  width,
  containerWidth,
  ratio,
  onRatioChange,
  onCommit,
  onDraggingChange,
  dragging,
}: PanelResizeHandleProps) {
  const drag = useRef<Drag | null>(null);
  /** The last split this handle asked for, which a cancelled drag still has to commit. */
  const applied = useRef(ratio);
  const latestX = useRef(0);
  const frame = useRef<number | null>(null);
  // Read through a ref: a drag in flight must not be re-bound as the parent re-renders.
  const callbacks = useRef({ onRatioChange, onCommit, onDraggingChange });
  useEffect(() => {
    callbacks.current = { onRatioChange, onCommit, onDraggingChange };
  });

  /** Ask for a split, and remember it: the commit may arrive before React has re-rendered. */
  const change = useCallback((next: number, commit: boolean) => {
    const clamped = clampPanelRatio(next);
    applied.current = clamped;
    callbacks.current.onRatioChange(clamped);
    if (commit) callbacks.current.onCommit(clamped);
  }, []);

  const apply = useCallback(
    (clientX: number) => {
      const active = drag.current;
      if (active === null) return;
      // The handle sits on the panel's left edge, so moving left makes the panel wider.
      change((active.base - (clientX - active.originX)) / active.row, false);
    },
    [change],
  );

  const end = useCallback(() => {
    const active = drag.current;
    if (active === null) return;
    drag.current = null;
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    if (active.element.hasPointerCapture(active.pointer)) active.element.releasePointerCapture(active.pointer);
    callbacks.current.onDraggingChange(false);
    callbacks.current.onCommit(applied.current);
  }, []);

  // A drag left hanging by an unmount would keep the panel in its no-transition state.
  useEffect(() => end, [end]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || drag.current !== null || containerWidth <= 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      element: event.currentTarget,
      pointer: event.pointerId,
      originX: event.clientX,
      base: width,
      row: containerWidth,
    };
    applied.current = ratio;
    callbacks.current.onDraggingChange(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointer !== event.pointerId) return;
    latestX.current = event.clientX;
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null;
      apply(latestX.current);
    });
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointer !== event.pointerId) return;
    apply(event.clientX);
    end();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowLeft" ? STEP : event.key === "ArrowRight" ? -STEP : 0;
    if (step === 0) return;
    event.preventDefault();
    change(ratio + step, true);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the report panel"
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={35}
      aria-valuemax={70}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={end}
      onKeyDown={onKeyDown}
      className="group absolute inset-y-0 -left-1 z-10 hidden w-2 cursor-col-resize touch-none outline-none lg:block"
    >
      <div
        className={cn(
          "mx-auto h-full w-px transition-colors group-hover:bg-ring group-focus-visible:bg-ring",
          dragging && "bg-ring",
        )}
      />
    </div>
  );
}
