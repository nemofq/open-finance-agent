/**
 * `word-extractor` is plain JavaScript and ships no type declarations, so this describes the API
 * `src/lib/attachments/parse/legacy-doc.ts` calls. Written against version 1.0.4 (`lib/word.js`
 * and `lib/document.js`); the package is pinned, so a mismatch would show up as a version bump.
 *
 * Only what the parser calls is described. Nothing in the library writes a `.doc`.
 */

declare module "word-extractor" {
  interface FilterOptions {
    /**
     * Maps Word's smart quotes, dashes and control markers onto plain equivalents. Defaults to
     * true, which is what makes the output readable as text.
     */
    filterUnicode?: boolean;
  }

  /** The text of one file; only the body is read here. */
  class Document {
    getBody(options?: FilterOptions): string;
  }

  class WordExtractor {
    /**
     * Reads a file path or the bytes themselves. The container decides the reader: OLE2 is taken as
     * a Word 97–2003 file and a zip as an Open Office XML one. Rejects when it is neither, and when
     * the file is damaged or encrypted.
     */
    extract(source: string | Buffer): Promise<Document>;
  }

  export = WordExtractor;
}
