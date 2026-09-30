"use client";

import { useState } from "react";
import { Clock3Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { TaskEditor } from "./task-editor";

/** A chat's Schedule button: the Scheduled page's task editor, set to continue this chat. */
export function ScheduleDialog({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="shrink-0">
            <Clock3Icon />
            <span className="hidden sm:inline">Schedule</span>
          </Button>
        }
      />
      {/* Mounted only while open, so each opening starts from a blank draft. */}
      {open ? <TaskEditor task={null} sessions={[]} fromChatId={sessionId} onClose={() => setOpen(false)} /> : null}
    </Dialog>
  );
}
