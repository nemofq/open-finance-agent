"use client";

import { skillTurnLabel } from "@/lib/skills/label";

export interface ExamplePrompt {
  text: string;
  skill?: string;
}

const EXAMPLES: ExamplePrompt[] = [
  { text: "Preview $NVDA's next earnings" },
  { text: "$AAPL", skill: "earnings-review" },
  { text: "Compare $MSFT and $GOOGL revenue growth over the last 8 quarters" },
];

function label(example: ExamplePrompt): string {
  return skillTurnLabel(example.skill, example.text);
}

/** Shown for a session with no messages yet. */
export function ChatWelcome({ onPick }: { onPick: (example: ExamplePrompt) => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="flex flex-col gap-2">
        <h2 className="font-heading text-xl font-medium">Open Finance Agent</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          Ask about a company, a filing or an earnings print. Mention tickers as $TICKER, or start with
          / to run a skill.
        </p>
      </div>
      <ul className="flex max-w-lg flex-wrap justify-center gap-2">
        {EXAMPLES.map((example) => (
          <li key={label(example)}>
            <button
              type="button"
              onClick={() => onPick(example)}
              className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {label(example)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
