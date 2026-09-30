"use client";

import type { ReactNode } from "react";
import { cn } from "cn";
import { StatusLine } from "@/components/shared/field-row";
import { PendingButton } from "@/components/shared/pending-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface FormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  /** Classes over the default: a form as wide as `sm:max-w-lg`, scrolling past 85% of the screen. */
  className?: string;
  /** Why the last submit failed, shown above the buttons. */
  error?: string | null;
  submitLabel: string;
  /** The submit is running: the buttons are disabled and the dialog will not close. */
  submitting: boolean;
  canSubmit?: boolean;
  destructive?: boolean;
  onSubmit: () => void;
  /** The form's fields; a confirmation has none. */
  children?: ReactNode;
}

/** A dialog that ends in Cancel and one submit button, the shell of every Add, Edit and Delete. */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  className,
  error,
  submitLabel,
  submitting,
  canSubmit = true,
  destructive,
  onSubmit,
  children,
}: FormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className={cn("max-h-[85vh] overflow-y-auto sm:max-w-lg", className)}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        {error ? <StatusLine ok={false}>{error}</StatusLine> : null}
        <DialogFooter>
          <Button variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <PendingButton
            variant={destructive ? "destructive" : "default"}
            pending={submitting}
            disabled={!canSubmit}
            onClick={onSubmit}
          >
            {submitLabel}
          </PendingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
