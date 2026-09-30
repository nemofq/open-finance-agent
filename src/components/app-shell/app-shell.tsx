"use client";

import { PanelLeftIcon } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "cn";
import { useNewChat } from "./new-chat";
import { SessionSidebar } from "./session-sidebar";
import { hasSidebarToggled, toggleSidebar, useSidebarCollapsed } from "./sidebar-state";
import { useShortcut } from "./use-shortcut";

/** Sidebar + main column; below `md` the sidebar collapses into a sheet. */
export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  // Cmd/Ctrl+K starts a new chat even from the composer; Cmd/Ctrl+B, the editor-wide convention
  // for the side panel, leaves a field's own "b" alone.
  useShortcut("k", useNewChat());
  useShortcut("b", toggleSidebar, { skipTyping: true });
  const collapsed = useSidebarCollapsed();

  return (
    // A short delay keeps tooltips from flashing at a pointer only crossing the column.
    <TooltipProvider delay={300}>
      <div className="flex h-dvh w-full overflow-hidden">
        {/* The column slides between the expanded width and the 56px rail, clipping its content
            rather than reflowing it; a restored state paints at its width without sliding. */}
        <aside
          className={cn(
            "hidden shrink-0 overflow-hidden border-r md:block",
            collapsed ? "w-14" : "w-76",
            hasSidebarToggled() && "transition-[width] duration-150 ease-out motion-reduce:transition-none",
          )}
        >
          <SessionSidebar collapsed={collapsed} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-2 border-b px-2 py-1.5 md:hidden">
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Open sessions" />}>
                <PanelLeftIcon />
              </SheetTrigger>
              <SheetContent side="left" className="w-76 p-0">
                <SheetTitle className="sr-only">Sessions</SheetTitle>
                <SessionSidebar onNavigate={() => setOpen(false)} />
              </SheetContent>
            </Sheet>
            <span className="font-heading text-sm font-medium">Open Finance Agent</span>
          </header>

          <main className="min-h-0 flex-1">{children}</main>
        </div>
      </div>
      {/* One for every page, since the sidebar on each of them raises toasts too. */}
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}
