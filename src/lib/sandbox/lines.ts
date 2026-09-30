/**
 * JSON-lines framing for the sandbox process: stdout arrives in arbitrary chunks, and one
 * message is one line. Kept apart from the process so it can be tested without spawning Deno.
 */

export interface LineReaderHandlers {
  onLine(line: string): void;
  /** A single line grew past the cap, so the stream is treated as runaway output. */
  onOverflow(bytes: number): void;
}

export interface LineReader {
  push(chunk: string): void;
}

/**
 * Split incoming text on newlines, buffering the partial line between chunks.
 * Blank lines are dropped; a line longer than `maxLineBytes` discards the buffer and reports.
 */
export function createLineReader(handlers: LineReaderHandlers, maxLineBytes: number): LineReader {
  let buffer = "";
  return {
    push(chunk: string): void {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) handlers.onLine(line);
        newline = buffer.indexOf("\n");
      }
      if (buffer.length > maxLineBytes) {
        const bytes = buffer.length;
        buffer = "";
        handlers.onOverflow(bytes);
      }
    },
  };
}
