"use client";

import { Children, cloneElement, isValidElement, type ReactNode } from "react";
import { TickerHoverCard } from "./ticker-hover-card";

const CASHTAG = /(?<![\$\\\w])\$[A-Z]{1,5}(?:\.[A-Z])?\b(?!\$)/g;

/** Elements whose text is code or math and must never be tokenised. */
const OPAQUE_TAGS = new Set(["code", "pre", "math"]);

function tokenize(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(CASHTAG)) {
    const start = match.index;
    if (start > cursor) nodes.push(text.slice(cursor, start));
    nodes.push(<TickerHoverCard key={`${keyPrefix}-${start}`} symbol={match[0].slice(1)} />);
    cursor = start + match[0].length;
  }
  if (nodes.length === 0) return [text];
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

/** Replace `$TICKER` in every text node of a React subtree, leaving code and math untouched. */
export function withTickerChips(children: ReactNode): ReactNode {
  return Children.map(children, (child, index) => {
    if (typeof child === "string") return tokenize(child, String(index));
    if (!isValidElement<{ children?: ReactNode; className?: string }>(child)) return child;
    if (typeof child.type === "string" && OPAQUE_TAGS.has(child.type)) return child;
    if (typeof child.props.className === "string" && child.props.className.includes("katex")) return child;
    if (child.props.children === undefined) return child;
    return cloneElement(child, undefined, withTickerChips(child.props.children));
  });
}
