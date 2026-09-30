"use client";

import type { ReactNode } from "react";
import { FormDialog } from "@/components/shared/form-dialog";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

/** The one confirmation every destructive action goes through. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  pending,
  onOpenChange,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      className="sm:max-w-sm"
      submitLabel={confirmLabel}
      submitting={pending}
      destructive
      onSubmit={onConfirm}
    />
  );
}
