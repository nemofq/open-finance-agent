"use client";

import { cn } from "cn";
import { ChevronRightIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

/**
 * A line that shows or hides what it sums up, closed to begin with. `summary` is a function when
 * its wording follows the state.
 */
export function Disclosure({
  summary,
  className,
  triggerClassName,
  children,
}: {
  summary: ReactNode | ((open: boolean) => ReactNode);
  className?: string;
  triggerClassName: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className={className}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={triggerClassName}>
        <ChevronRightIcon className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
        {typeof summary === "function" ? summary(open) : summary}
      </button>
      {open && children}
    </div>
  );
}
