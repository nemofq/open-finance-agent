"use client";

import { formatModelPrice } from "@/components/shared/format";
import { PendingButton } from "@/components/shared/pending-button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import type { ModelNotice } from "@/lib/config/schema";

/** "the default model and the scheduled task “Brief”", in the order they were moved. */
function listUses(uses: string[]): string {
  return uses.length < 2 ? (uses[0] ?? "") : `${uses.slice(0, -1).join(", ")} and ${uses.at(-1)}`;
}

function NoticeItem({ notice: { provider, from, to, uses } }: { notice: ModelNotice }) {
  const before = formatModelPrice(from.pricing);
  const after = formatModelPrice(to.pricing);
  return (
    <li>
      {provider}: {from.name} → {to.name}, for {listUses(uses)}.
      {before !== after ? (
        <span className="font-medium"> Price per M tokens, input / output: {before} → {after}.</span>
      ) : null}
    </li>
  );
}

export interface ModelNoticesProps {
  notices: ModelNotice[];
  dismissing: boolean;
  onDismiss: () => void;
}

/** Which saved models an upgrade moved to their successor and what they cost now, until dismissed. */
export function ModelNotices({ notices, dismissing, onDismiss }: ModelNoticesProps) {
  if (notices.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Models replaced</CardTitle>
        <CardDescription>
          These models are no longer offered, so settings that used them now use their successor. Chats already started
          keep their model.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {notices.map((notice, index) => (
            <NoticeItem key={index} notice={notice} />
          ))}
        </ul>
      </CardContent>
      <CardFooter className="justify-end">
        <PendingButton variant="outline" pending={dismissing} onClick={onDismiss}>
          Dismiss
        </PendingButton>
      </CardFooter>
    </Card>
  );
}
