/** A content block of any kind: text, image, thinking or tool call. Only a text block has `text`. */
interface Block {
  type: string;
}

function isText(block: Block): block is { type: "text"; text: string } {
  return block.type === "text";
}

/** The text blocks of a message or tool result, in order, joined by `separator`; every other kind is left out. */
export function blockText(content: readonly Block[], separator: string): string {
  return content.flatMap((block) => (isText(block) ? [block.text] : [])).join(separator);
}
