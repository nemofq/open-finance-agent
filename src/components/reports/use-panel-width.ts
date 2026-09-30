"use client";

import { type RefObject, useCallback, useState } from "react";
import { createStoredValue } from "@/components/shared/stored-value";
import { clampPanelRatio, DEFAULT_PANEL_RATIO, panelWidth } from "./artifact-state";
import { useElementWidth } from "./use-element-width";

/** The split, unlike the view, is one preference for the whole app and survives a restart. */
const ratioStore = createStoredValue("open-finance.artifacts.ratio", (raw) => clampPanelRatio(Number(raw)), DEFAULT_PANEL_RATIO);

export interface PanelWidth {
  /** Goes on the flex row holding the chat column and the artifact column. */
  containerRef: RefObject<HTMLDivElement | null>;
  /** The row's own width, `null` before the first measurement. */
  containerWidth: number | null;
  /** The panel's width in px, `0` when the row is too narrow to split, `null` until measured. */
  width: number | null;
  ratio: number;
  /** Move the split. Called on every frame of a drag, so it does not touch storage. */
  setRatio: (ratio: number) => void;
  /** Keep the split for next time, once the gesture that set it is over. */
  commitRatio: (ratio: number) => void;
  /** True mid-drag, so the width follows the pointer instead of animating behind it. */
  dragging: boolean;
  setDragging: (dragging: boolean) => void;
}

/** The artifact column's width: the row's measurement, the remembered split, and the drag. */
export function usePanelWidth(): PanelWidth {
  const { ref: containerRef, width: containerWidth } = useElementWidth<HTMLDivElement>();
  // The stored split only reaches the first client render; the server's has none, and cannot
  // disagree either, because the width stays unresolved until the row has been measured.
  const [ratio, setRatio] = useState(ratioStore.getSnapshot);
  const [dragging, setDragging] = useState(false);

  return {
    containerRef,
    containerWidth,
    width: containerWidth === null ? null : panelWidth(containerWidth, ratio),
    ratio,
    setRatio: useCallback((next: number) => setRatio(clampPanelRatio(next)), []),
    commitRatio: ratioStore.set,
    dragging,
    setDragging,
  };
}
