"use client";

import { Fragment } from "react";
import { cn } from "cn";

export interface Suggestion {
  /** Value handed back on select. */
  id: string;
  primary: string;
  secondary?: string;
  /** Optional section title; a header is drawn wherever it changes, and is not selectable. */
  group?: string;
}

interface ComposerMenuProps {
  id: string;
  label: string;
  items: Suggestion[];
  activeIndex: number;
  /** Shown instead of the list while loading or when nothing matches. */
  status?: string;
  onSelect: (index: number) => void;
  onHighlight: (index: number) => void;
}

/** Listbox anchored above the composer, driven entirely from the textarea's keyboard events. */
export function ComposerMenu({
  id,
  label,
  items,
  activeIndex,
  status,
  onSelect,
  onHighlight,
}: ComposerMenuProps) {
  return (
    <div className="absolute inset-x-0 bottom-full z-30 mb-2 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-md">
      {items.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">{status ?? "No matches"}</p>
      ) : (
        <ul id={id} role="listbox" aria-label={label} className="max-h-64 overflow-y-auto py-1">
          {items.map((item, index) => (
            <Fragment key={`${item.group ?? ""}:${item.id}`}>
              {item.group && item.group !== items[index - 1]?.group && (
                <li
                  role="presentation"
                  className="px-3 pt-2 pb-0.5 text-[11px] font-medium text-muted-foreground first:pt-1"
                >
                  {item.group}
                </li>
              )}
              <li
                id={`${id}-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                ref={
                  index === activeIndex
                    ? (node) => node?.scrollIntoView({ block: "nearest" })
                    : undefined
                }
                // Mouse down would blur the textarea and close the list before the click lands.
                onMouseDown={(event) => {
                  event.preventDefault();
                  onSelect(index);
                }}
                onMouseEnter={() => onHighlight(index)}
                className={cn(
                  "flex cursor-pointer items-baseline gap-2 px-3 py-1.5",
                  index === activeIndex && "bg-muted",
                )}
              >
                <span className="shrink-0 font-mono text-xs">{item.primary}</span>
                {item.secondary && (
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {item.secondary}
                  </span>
                )}
              </li>
            </Fragment>
          ))}
        </ul>
      )}
    </div>
  );
}
