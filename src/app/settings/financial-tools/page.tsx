import { ModuleSettingsPage } from "@/components/settings/module-settings-page";

export default function FinancialToolsSettingsPage() {
  return (
    <ModuleSettingsPage
      kind="financial-tool"
      title="Financial tools"
      description="Deterministic tools the agent computes and writes with: the calculator that runs the numbers and the reports it produces. Neither adds to what the agent knows."
      emptyHint="Financial tool modules appear here once they are added as src/lib/<capability>/tool.ts."
    />
  );
}
