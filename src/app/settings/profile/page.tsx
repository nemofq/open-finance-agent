import { SettingsHeader } from "@/components/shared/page-shell";
import { HoldingsSection } from "@/components/portfolio/holdings-section";
import { ProfileSection } from "@/components/settings/profile/profile-section";

/** Investor profile settings page. */
export default function InvestorProfileSettingsPage() {
  return (
    <div className="space-y-8">
      <SettingsHeader
        title="Investor profile"
        description="What you tell the agent about yourself, and the holdings it may reason about. The agent never writes this; your holdings reach the model only when it calls portfolio_get."
      />
      <ProfileSection />
      <HoldingsSection />
    </div>
  );
}
