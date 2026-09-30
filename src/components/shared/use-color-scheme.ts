"use client";

import { useTheme } from "next-themes";

/** The theme on screen, "system" resolved, for embeds that know only light and dark. */
export function useColorScheme(): "light" | "dark" {
  return useTheme().resolvedTheme === "dark" ? "dark" : "light";
}
