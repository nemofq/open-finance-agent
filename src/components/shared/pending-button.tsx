"use client";

import type { ComponentProps } from "react";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";

/** A button that shows a spinner and stays disabled while its action runs. */
export function PendingButton({
  pending,
  disabled,
  children,
  ...props
}: ComponentProps<typeof Button> & { pending: boolean }) {
  return (
    <Button disabled={pending || disabled} {...props}>
      {pending ? <Loader2Icon className="animate-spin" /> : null}
      {children}
    </Button>
  );
}
