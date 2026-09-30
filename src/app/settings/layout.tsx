import type { ReactNode } from "react";
import { SettingsNav } from "@/components/settings/settings-nav";
import { PageShell } from "@/components/shared/page-shell";

/** Settings scroll inside the shell's fixed-height main column; the nav rail stays put on desktop. */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <PageShell className="md:flex-row md:gap-10 md:py-10">
      <aside className="md:sticky md:top-10 md:w-40 md:shrink-0 md:self-start">
        <SettingsNav />
      </aside>
      <main className="min-w-0 flex-1 pb-12">{children}</main>
    </PageShell>
  );
}
