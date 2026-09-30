import { ModuleSettingsPage } from "@/components/settings/module-settings-page";

export default function DataConnectionsSettingsPage() {
  return (
    <ModuleSettingsPage
      kind="data-provider"
      title="Data connections"
      description="Sources the agent pulls filings, fundamentals and market data from, with a tier the harness trusts them by."
      emptyHint="Data connection modules appear here once they are added as src/lib/providers/<name>/module.ts."
      mcpClass="data"
    />
  );
}
