"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { McpToolInfo } from "@/lib/mcp/types";

export interface ToolAllowlistProps {
  tools: McpToolInfo[];
  /** Selected tool names. Empty means "no restriction" — every tool stays available. */
  value: string[];
  onChange: (next: string[]) => void;
}

/** Checkbox list narrowing which of a server's tools the agent may call. */
export function ToolAllowlist({ tools, value, onChange }: ToolAllowlistProps) {
  const toggle = (name: string, checked: boolean) =>
    onChange(checked ? [...value, name] : value.filter((item) => item !== name));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {value.length === 0
            ? `All ${tools.length} tools available to the agent.`
            : `${value.length} of ${tools.length} tools allowed.`}
        </p>
        <div className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => onChange(tools.map((tool) => tool.name))}
          >
            Select all
          </Button>
          <Button type="button" variant="ghost" size="xs" onClick={() => onChange([])}>
            Clear
          </Button>
        </div>
      </div>
      <ul className="max-h-64 space-y-1.5 overflow-y-auto rounded-lg border p-2.5">
        {tools.map((tool) => (
          <li key={tool.name}>
            <label className="flex cursor-pointer items-start gap-2">
              <Checkbox
                className="mt-0.5"
                checked={value.includes(tool.name)}
                onCheckedChange={(checked) => toggle(tool.name, checked)}
              />
              <span className="min-w-0">
                <span className="block truncate font-mono text-xs">{tool.name}</span>
                {tool.description ? (
                  <span className="block text-xs text-muted-foreground">{tool.description}</span>
                ) : null}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
