import type { ReactNode } from "react";

/** A titled group of related fields; two columns from `sm` up unless a child opts out. */
export function FieldGroup({
  legend,
  description,
  children,
}: {
  legend: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm leading-none font-medium">{legend}</legend>
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

/** Spans both columns of a `FieldGroup`, for tag lists and checkbox grids. */
export function FieldSpan({ children }: { children: ReactNode }) {
  return <div className="sm:col-span-2">{children}</div>;
}
