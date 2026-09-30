/**
 * Which module parses which `ParserId`: one lazy loader per id, and the dispatch that runs one.
 *
 * **Only the worker imports this file** (`worker.ts`, dynamically, once its resolver hooks are in
 * place). The request thread never does: `parse/index.ts` only names a parser id and hands the
 * bytes to the worker. That is what keeps `mammoth`, `exceljs`, `pdfjs-dist` and the rest out of
 * the server bundle — the loaders below are dynamic, carry `turbopackIgnore` so the bundler leaves
 * them alone, and at run time resolve against this directory in `src/`.
 *
 * `ParserLoaders` is a mapped type over `ParserId`, so a parser id added to `formats.ts` without a
 * loader here fails to typecheck rather than failing a user's upload.
 */

import type { ParserId } from "../formats";
import type { ParsedAttachment } from "../types";
import type { ParseRequest } from "./index";

/** The shape every parser module exports, fixed for all of them. */
export interface ParserModule {
  parse(bytes: Uint8Array, name: string): Promise<ParsedAttachment>;
}

export type ParserLoader = () => Promise<ParserModule>;

/** Exactly one loader per parser id: a missing one is a type error. */
export type ParserLoaders = { readonly [Id in ParserId]: ParserLoader };

export const PARSERS: ParserLoaders = {
  text: () => import(/* turbopackIgnore: true */ "./text"),
  html: () => import(/* turbopackIgnore: true */ "./html"),
  docx: () => import(/* turbopackIgnore: true */ "./docx"),
  "legacy-doc": () => import(/* turbopackIgnore: true */ "./legacy-doc"),
  tabular: () => import(/* turbopackIgnore: true */ "./tabular"),
  pptx: () => import(/* turbopackIgnore: true */ "./pptx"),
  pdf: () => import(/* turbopackIgnore: true */ "./pdf"),
};

/** Runs **inside the worker**: load the parser the request names and hand it the bytes. */
export async function runParser(request: ParseRequest): Promise<ParsedAttachment> {
  const load: ParserLoader | undefined = Object.hasOwn(PARSERS, request.parser) ? PARSERS[request.parser] : undefined;
  if (!load) throw new Error(`No parser is registered as "${request.parser}".`);
  const parser = await load();
  return parser.parse(new Uint8Array(request.bytes), request.name);
}
