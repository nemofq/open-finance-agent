/**
 * How a `/skill` turn reads to the user: the chip followed by what they typed.
 * Kept free of node imports so client components can use it too.
 */
export function skillTurnLabel(skill: string | undefined, text: string): string {
  return skill ? `/${skill} ${text}`.trim() : text;
}
