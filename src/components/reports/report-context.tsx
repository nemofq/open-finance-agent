"use client";

import { createContext, useContext } from "react";

/** Opens the report produced by the given tool call in the side panel. */
export type OpenReport = (id: string) => void;

interface ReportControl {
  open: OpenReport;
  /** The report the artifact column is showing, so its card in the transcript can say so. */
  activeId: string | null;
}

const ReportContext = createContext<ReportControl | null>(null);

export const ReportProvider = ReportContext.Provider;

/** `null` outside a chat, so a report card can hide its "View" action. */
export function useOpenReport(): OpenReport | null {
  return useContext(ReportContext)?.open ?? null;
}

export function useActiveReportId(): string | null {
  return useContext(ReportContext)?.activeId ?? null;
}
