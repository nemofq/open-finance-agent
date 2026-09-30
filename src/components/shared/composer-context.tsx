"use client";

import { createContext, useContext } from "react";

/** Appends a token (e.g. `$AAPL`) to the composer and focuses it. */
export type ComposerInsert = (text: string) => void;

const InsertContext = createContext<ComposerInsert | null>(null);

export const ComposerInsertProvider = InsertContext.Provider;

/** `null` outside a chat, so hover cards can hide the "Ask about" action. */
export function useComposerInsert(): ComposerInsert | null {
  return useContext(InsertContext);
}
