"use client";

import type { ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { withTickerChips } from "@/components/market/ticker-chip";

type Block = { children?: ReactNode };

/** Only text-bearing blocks are overridden; the rest is styled by `.markdown` in globals.css. */
const components: Components = {
  p: ({ children }: Block) => <p>{withTickerChips(children)}</p>,
  li: ({ children }: Block) => <li>{withTickerChips(children)}</li>,
  th: ({ children }: Block) => <th>{withTickerChips(children)}</th>,
  td: ({ children }: Block) => <td>{withTickerChips(children)}</td>,
  h1: ({ children }: Block) => <h1>{withTickerChips(children)}</h1>,
  h2: ({ children }: Block) => <h2>{withTickerChips(children)}</h2>,
  h3: ({ children }: Block) => <h3>{withTickerChips(children)}</h3>,
  blockquote: ({ children }: Block) => <blockquote>{withTickerChips(children)}</blockquote>,
  // Wide financial tables scroll on their own rather than widening the page.
  table: ({ children }: Block) => (
    <div className="my-3 overflow-x-auto">
      <table>{children}</table>
    </div>
  ),
  a: ({ children, href }: Block & { href?: string }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
};

/** Some models wrap an entire reply in a ```markdown fence; unwrap it so the report renders as prose. */
const WHOLE_FENCE = /^\s*```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/;

export function unwrapWholeFence(text: string): string {
  const match = WHOLE_FENCE.exec(text);
  return match && !match[1].includes("```") ? match[1] : text;
}

export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {unwrapWholeFence(children)}
      </ReactMarkdown>
    </div>
  );
}
