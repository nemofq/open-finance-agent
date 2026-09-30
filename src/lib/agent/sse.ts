import type { AgentEvent, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { AssistantMessageEvent } from "@earendil-works/pi-ai";
import type { SseEvent } from "@/lib/agent/events";

/** Tool results carry model-facing content blocks; the UI shows their text. */
function resultText(result: unknown): string {
  const content = (result as AgentToolResult<unknown> | undefined)?.content;
  if (!Array.isArray(content)) return typeof result === "string" ? result : JSON.stringify(result ?? null);
  return content
    .map((part) => (part.type === "text" ? part.text : `[${part.type}]`))
    .join("\n")
    .trim();
}

/**
 * `toolcall_start` carries no tool call of its own; the name, when the provider has
 * sent it yet, is on the growing block at `contentIndex` of the partial message.
 */
function pendingToolName(event: Extract<AssistantMessageEvent, { type: "toolcall_start" }>): string {
  const block = event.partial.content[event.contentIndex];
  return block?.type === "toolCall" ? block.name : "";
}

/**
 * Map one pi agent event onto the wire protocol consumed by the chat UI.
 * Events the UI does not need (turn boundaries, tool progress) map to nothing.
 */
export function toSseEvents(event: AgentEvent): SseEvent[] {
  switch (event.type) {
    case "message_start":
      // pi's system messages hold the prompt and the tools, which the browser is never sent.
      return event.message.role === "system" ? [] : [{ type: "message_start" }];

    case "message_update": {
      const inner = event.assistantMessageEvent;
      if (inner.type === "text_delta") return [{ type: "text_delta", delta: inner.delta }];
      if (inner.type === "thinking_delta") return [{ type: "thinking_delta", delta: inner.delta }];
      // Signals the UI that a long tool call (a report, say) is still streaming its arguments.
      if (inner.type === "toolcall_start") return [{ type: "tool_call_pending", name: pendingToolName(inner) }];
      return [];
    }

    case "tool_execution_start":
      return [{ type: "tool_call_start", id: event.toolCallId, name: event.toolName, args: event.args }];

    case "tool_execution_end":
      return [
        { type: "tool_call_end", id: event.toolCallId, result: resultText(event.result), isError: event.isError },
      ];

    case "message_end": {
      const { message } = event;
      if (message.role === "system") return [];
      const usage = message.role === "assistant" ? message.usage : undefined;
      return [
        ...(usage ? [{ type: "usage", usage } as const] : []),
        { type: "message_end", message },
      ];
    }

    default:
      return [];
  }
}

/** Serialise one wire event as an SSE frame. */
export function encodeSse(event: SseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
