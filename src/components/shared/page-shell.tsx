import type * as React from "react";
import { useId } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "cn";
import { PendingButton } from "@/components/shared/pending-button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * A full page in the shell's main column: a centred column, scrolled at the window's edge so the
 * scrollbar never sits inside the content.
 */
export function PageShell({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className="h-full overflow-y-auto [scrollbar-gutter:stable]">
      <div className={cn("mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6", className)}>{children}</div>
    </div>
  );
}

/** A top-level page's title with its icon, a description, and the page's actions on the right. */
export function PageHeader({
  icon: Icon,
  title,
  description,
  actions,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  actions: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="flex items-center gap-2 font-heading text-2xl font-semibold">
          <Icon className="size-6" />
          {title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex flex-wrap gap-2">{actions}</div>
    </div>
  );
}

/** A boxed message on a page or in a dialog: an error, or the outcome of what the user just did. */
export function Notice({
  tone,
  className,
  children,
}: {
  tone: "error" | "info";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-lg border px-3 py-2 text-sm",
        tone === "error" ? "border-destructive/30 bg-destructive/5 text-destructive" : "text-muted-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Page title and description, with an optional control such as Add on the right. */
export function SettingsHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-4">
      <div className="min-w-0 space-y-1">
        <h1 className="font-heading text-lg font-medium tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

/** Heading for one section of a settings page; `id` is for the section's `aria-labelledby`. */
export function SectionHeader({
  id,
  title,
  description,
  action,
}: {
  id: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0 space-y-0.5">
        <h2 id={id} className="font-heading text-base font-semibold tracking-tight">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

/** Save control that doubles as the unsaved-changes indicator for a page or card. */
export function SaveButton({
  dirty,
  saving,
  onClick,
  className,
}: {
  dirty: boolean;
  saving: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <PendingButton onClick={onClick} pending={saving} disabled={!dirty} className={className}>
      {dirty && !saving ? <span aria-hidden className="size-1.5 rounded-full bg-current" /> : null}
      {dirty ? "Save changes" : "Saved"}
    </PendingButton>
  );
}

/** A card header's labelled Enabled switch, which applies at once. */
export function EnabledSwitch({
  checked,
  disabled,
  onCheckedChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
        Enabled
      </Label>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
