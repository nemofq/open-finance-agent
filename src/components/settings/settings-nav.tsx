"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { cn } from "cn";

const tabs = [
  { href: "/settings/llm", label: "LLM" },
  { href: "/settings/providers", label: "Data connections" },
  { href: "/settings/financial-tools", label: "Financial tools" },
  { href: "/settings/tools", label: "General tools" },
  { href: "/settings/skills", label: "Skills" },
  { href: "/settings/profile", label: "Investor profile" },
  { href: "/settings/memory", label: "Memory" },
] as const;

/** Vertical tab rail on desktop, a horizontally scrollable row below `md`. */
export function SettingsNav() {
  const pathname = usePathname();

  return (
    <div className="flex flex-col gap-3">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-3.5" />
        Chat
      </Link>
      <nav
        aria-label="Settings sections"
        className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 md:mx-0 md:flex-col md:overflow-visible md:px-0 md:pb-0"
      >
        {tabs.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-lg px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors",
                active
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
