"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { Message } from "./message";
import type { ChatItem } from "./transcript";

/** Scrolls to the newest content unless the user has scrolled up to read. */
export function MessageList({ items, footer }: { items: ChatItem[]; footer?: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const container = containerRef.current;
    if (container && pinned.current) container.scrollTop = container.scrollHeight;
  });

  // Opening the report panel narrows the list and reflows every message, which moves the
  // bottom out from under the scroll position; re-pin when that happens.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (pinned.current) container.scrollTop = container.scrollHeight;
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      onScroll={(event) => {
        const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
        pinned.current = scrollHeight - scrollTop - clientHeight < 80;
      }}
      className="min-h-0 flex-1 overflow-y-auto"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6">
        {items.map((item) => (
          <Message key={item.key} item={item} />
        ))}
        {footer}
      </div>
    </div>
  );
}
