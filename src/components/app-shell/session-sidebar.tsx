"use client";

import {
  AlarmClockIcon,
  CircleDollarSignIcon,
  FolderIcon,
  PanelLeftIcon,
  SearchIcon,
  SettingsIcon,
  SquarePenIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "cn";
import { useNewChat } from "./new-chat";
import { BadgeCount, ScheduledRailIcon, useScheduledUnread } from "./scheduled-link";
import { SessionList, useSessionIndex } from "./session-list";
import { toggleSidebar } from "./sidebar-state";
import { ThemeToggle } from "./theme-toggle";

/** Rail tooltips are a discovery aid, not a hint to flash at every passing pointer. */
const RAIL_TOOLTIP_DELAY_MS = 500;

/** Every rail control is the same 36px box, centred in the 56px column. */
const RAIL_CONTROL =
  "group/rail flex size-9 shrink-0 items-center justify-center rounded-lg outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-4.5";

/** Application brand icon. */
function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-5 shrink-0", className)}
    >
      <rect x="1.75" y="1.75" width="16.5" height="16.5" rx="5" />
      <path d="M5.5 12.75 8.75 9.5l2.25 2.25L14.5 8" />
    </svg>
  );
}

/** Avoids SSR hydration mismatch by defaulting to non-Mac until client mount. */
const noSubscribe = () => () => undefined;
const notMac = () => false;

function isMacPlatform(): boolean {
  const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return /mac|iphone|ipad/i.test(data?.platform ?? navigator.platform);
}

function useIsMac(): boolean {
  return useSyncExternalStore(noSubscribe, isMacPlatform, notMac);
}

function FootLink({ href, icon: Icon, label, active, onNavigate, className, children }: {
  href: string;
  icon: LucideIcon;
  label: string;
  active: boolean;
  onNavigate?: () => void;
  className?: string;
  /** Trailing content, such as a count. */
  children?: ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 items-center gap-2 rounded-lg px-2 text-sm transition-colors hover:bg-sidebar-accent",
        active && "bg-sidebar-accent font-medium",
        className,
      )}
    >
      <Icon className="size-4 shrink-0" />
      {label}
      {children}
    </Link>
  );
}

/** A rail control: an icon box whose label only exists as a tooltip. */
function RailControl({ label, active, onClick, href, children }: {
  label: string;
  active?: boolean;
  onClick?: () => void;
  href?: string;
  children: ReactNode;
}) {
  const className = cn(RAIL_CONTROL, active && "bg-sidebar-accent");
  return (
    <Tooltip>
      <TooltipTrigger
        delay={RAIL_TOOLTIP_DELAY_MS}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        className={className}
        {...(href === undefined ? { onClick } : { render: <Link href={href} /> })}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The app's left column, as the 56px rail when collapsed or the full sidebar when not. It
 * composes the chat list and the Scheduled link, which keep their own data current, with the
 * collapse and theme preferences and the links to the other pages. The search state lives here
 * so that the rail's search control can open it on the way to expanding the column.
 */
export function SessionSidebar({ onNavigate, collapsed = false }: {
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const index = useSessionIndex();
  const scheduledUnread = useScheduledUnread();
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const pathname = usePathname();
  const newChat = useNewChat(onNavigate);
  const isMac = useIsMac();

  const shortcut = (key: string) => (isMac ? `⌘${key}` : `Ctrl ${key}`);
  const inPortfolio = pathname.startsWith("/portfolio");
  const inScheduled = pathname.startsWith("/scheduled");
  const inSettings = pathname.startsWith("/settings");

  if (collapsed) {
    return (
      <div className="flex h-full flex-col items-center gap-2 bg-sidebar px-2.5 py-3 text-sidebar-foreground">
        {/* The mark doubles as the expand affordance: hovering it swaps in the panel glyph. */}
        <RailControl label={`Expand sidebar (${shortcut("B")})`} onClick={toggleSidebar}>
          <BrandMark className="group-hover/rail:hidden" />
          <PanelLeftIcon className="hidden group-hover/rail:block" />
        </RailControl>
        <RailControl label={`New chat (${shortcut("K")})`} onClick={newChat}>
          <SquarePenIcon />
        </RailControl>
        <RailControl label={`Scheduled${scheduledUnread ? ` · ${scheduledUnread} unread` : ""}`} href="/scheduled" active={inScheduled}>
          <ScheduledRailIcon unread={scheduledUnread} />
        </RailControl>
        <RailControl
          label="Search chats"
          onClick={() => {
            setSearching(true);
            toggleSidebar();
          }}
        >
          <SearchIcon />
        </RailControl>

        <div className="flex-1" />

        <RailControl label="Portfolio" href="/portfolio" active={inPortfolio}>
          <CircleDollarSignIcon />
        </RailControl>
        <RailControl label="Settings" href="/settings" active={inSettings}>
          <SettingsIcon />
        </RailControl>
        <ThemeToggle className={RAIL_CONTROL} />
      </div>
    );
  }

  return (
    // A fixed width, matching `w-76` on the shell's `<aside>`: while the column slides shut it
    // clips this layout rather than reflowing its text.
    <div className="flex h-full w-76 flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-bar shrink-0 items-center gap-2 px-3">
        <Link
          href="/"
          onClick={onNavigate}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <BrandMark />
          <span className="truncate font-heading text-sm font-medium">Open Finance Agent</span>
        </Link>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Collapse sidebar"
          aria-keyshortcuts="Meta+B Control+B"
          title={`Collapse sidebar (${shortcut("B")})`}
          onClick={toggleSidebar}
          className="hidden md:flex"
        >
          <PanelLeftIcon />
        </Button>
      </div>

      <div className="flex shrink-0 flex-col gap-1 px-3 pb-3">
        <Button
          variant="outline"
          size="lg"
          className="w-full justify-start rounded-xl"
          title={`New chat (${shortcut("K")})`}
          aria-keyshortcuts="Meta+K Control+K"
          onClick={newChat}
        >
          <SquarePenIcon data-icon="inline-start" />
          New chat
          <span className="ml-auto text-[11px] font-normal text-muted-foreground">{shortcut("K")}</span>
        </Button>
        <FootLink href="/scheduled" icon={AlarmClockIcon} label="Scheduled" active={inScheduled} onNavigate={onNavigate}>
          {scheduledUnread > 0 && <BadgeCount count={scheduledUnread} />}
        </FootLink>
      </div>

      <SessionList
        index={index}
        searching={searching}
        onSearchingChange={setSearching}
        query={searchQuery}
        onQueryChange={setSearchQuery}
        onNavigate={onNavigate}
      />

      <div className="flex min-h-foot shrink-0 flex-col gap-0.5 border-t px-3 py-2">
        <FootLink
          href="/portfolio"
          icon={CircleDollarSignIcon}
          label="Portfolio"
          active={inPortfolio}
          onNavigate={onNavigate}
        />
        <div className="flex items-center gap-1">
          <FootLink
            href="/settings"
            icon={SettingsIcon}
            label="Settings"
            active={inSettings}
            onNavigate={onNavigate}
            className="min-w-0 flex-1"
          />
          <ThemeToggle />
        </div>
        {index && (
          <Tooltip>
            <TooltipTrigger
              render={<span />}
              className="flex items-center gap-1.5 px-2 pt-1 text-[11px] text-muted-foreground"
            >
              <FolderIcon className="size-3 shrink-0" />
              <span className="truncate">{index.dataDir}</span>
            </TooltipTrigger>
            <TooltipContent side="top" className="break-all">
              {index.dataDir}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
