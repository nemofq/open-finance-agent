import { ModuleSettingsPage } from "@/components/settings/module-settings-page";

export default function GeneralToolsSettingsPage() {
  return (
    <ModuleSettingsPage
      kind="tool"
      title="General tools"
      description="Everything else the agent can call: web search, memory, skills and any MCP server that is not a data connection."
      emptyHint="Tool modules appear here once they are added as src/lib/<capability>/tool.ts."
      mcpClass="general"
    />
  );
}
