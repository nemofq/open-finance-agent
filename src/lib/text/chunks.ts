/**
 * Passage retrieval over a long document: split it into paragraphs-sized chunks, score them
 * against a query, and return the best ones in reading order.
 *
 * A filing is one flat string and its chunks are labelled `[chunk 3/41]`; an attachment is a list
 * of pages or slides, and each chunk keeps the part it came from, `[page 14 · chunk 3/41]`.
 */

/** Chunks are packed up to roughly this many characters. */
const CHUNK_CHARS = 1_500;

/** How many passages a query returns by default. */
const TOP_CHUNKS = 6;

/** A piece of text with the part of the document it came from ("Page 14", "Slide 3"). */
export interface TextChunk {
  text: string;
  label?: string;
}

/** Split on line breaks, then pack lines up to roughly `size`. */
export function splitChunks(text: string, size = CHUNK_CHARS): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of text.split(/\n/)) {
    if (current && current.length + paragraph.length + 1 > size) {
      chunks.push(current);
      current = "";
    }
    current = current ? `${current}\n${paragraph}` : paragraph;
    while (current.length > size * 1.5) {
      chunks.push(current.slice(0, size));
      current = current.slice(size);
    }
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}

/** Split each section, so every chunk still says which page or slide it came from. */
export function chunkSections(sections: TextChunk[], size = CHUNK_CHARS): TextChunk[] {
  return sections.flatMap((section) =>
    splitChunks(section.text, size).map((text) => ({ text, ...(section.label ? { label: section.label } : {}) })),
  );
}

function terms(query: string): string[] {
  return [...new Set(query.toLowerCase().match(/[a-z0-9$%.]{3,}/g) ?? [])];
}

/** Term overlap, with a strong bonus when the whole phrase appears verbatim. */
function scoreChunk(chunk: string, query: string, queryTerms: string[]): number {
  const haystack = chunk.toLowerCase();
  let score = 0;
  for (const term of queryTerms) {
    const hits = haystack.split(term).length - 1;
    if (hits > 0) score += 1 + Math.log2(hits);
  }
  const phrase = query.trim().toLowerCase();
  if (phrase.length > 4 && haystack.includes(phrase)) score += 5;
  return score;
}

/** The best `count` chunks of a flat document, returned in document order. */
export function bestChunks(text: string, query: string, count = TOP_CHUNKS): string {
  return bestPassages(splitChunks(text).map((chunk) => ({ text: chunk })), query, count);
}

/** The best `count` chunks of a document already split into labelled parts, in reading order. */
export function bestPassages(chunks: TextChunk[], query: string, count = TOP_CHUNKS): string {
  return (
    matchingPassages(chunks, query, count) ??
    `No passage in this document (${chunks.length} chunks) mentions "${query}". Retry without a query to read the document from the top.`
  );
}

/** As `bestPassages`, but undefined when no chunk mentions the query, for a caller with its own fallback. */
export function matchingPassages(chunks: TextChunk[], query: string, count = TOP_CHUNKS): string | undefined {
  const queryTerms = terms(query);
  const ranked = chunks
    .map((chunk, index) => ({ index, chunk, score: scoreChunk(chunk.text, query, queryTerms) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .sort((a, b) => a.index - b.index);

  if (ranked.length === 0) return undefined;
  return ranked
    .map(({ index, chunk }) => {
      const where = chunk.label ? `${chunk.label} · ` : "";
      return `[${where}chunk ${index + 1}/${chunks.length}]\n${chunk.text}`;
    })
    .join("\n\n---\n\n");
}
