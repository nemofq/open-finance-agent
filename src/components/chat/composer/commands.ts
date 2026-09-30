/**
 * Built-in composer commands. They are typed like a skill (`/name`) and offered by the same `/`
 * picker, but they run against the app's own API instead of becoming a turn for the model.
 */

export interface CommandInfo {
  name: string;
  description: string;
}

export const COMMANDS: CommandInfo[] = [
  { name: "compact", description: "Summarise the chat so far into a research checkpoint" },
];

export function isCommand(name: string): boolean {
  return COMMANDS.some((command) => command.name === name);
}

/** `/compact` with the rest of the line as its focus, e.g. `/compact the guidance debate`. */
export interface CompactCommand {
  name: "compact";
  focus?: string;
}

const COMPACT = /^\/compact(?:\s+([\s\S]*))?$/;

/** The command the draft invokes, or `null` when it is an ordinary message. */
export function parseCommand(text: string): CompactCommand | null {
  const match = COMPACT.exec(text.trim());
  if (match === null) return null;
  const focus = match[1]?.trim();
  return focus ? { name: "compact", focus } : { name: "compact" };
}
