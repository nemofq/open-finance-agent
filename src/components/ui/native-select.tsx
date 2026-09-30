import type * as React from "react"
import { cn } from "cn"

/**
 * A plain `<select>` styled like `Input`, for short lists where the popover `Select` would be
 * heavier than the choice: account filters, column mapping, schedule types.
 */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn("h-8 rounded-lg border border-input bg-transparent px-2 text-sm text-foreground", className)}
      {...props}
    />
  )
}

export { NativeSelect }
