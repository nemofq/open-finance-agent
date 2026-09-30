"use client";

import { Separator } from "@/components/ui/separator";
import { compactGroup, type ProfileDraft } from "./draft";
import { CheckboxGroup, EnumField, TextField } from "@/components/shared/field-row";
import { TagInput } from "@/components/settings/tag-input";
import {
  answerDepths,
  capacitiesForLoss,
  experienceLevels,
  horizons,
  instrumentClasses,
  investingApproaches,
  investorRoles,
  liquidityLevels,
  primaryObjectives,
  riskTolerances,
} from "./options";
import { FieldGroup, FieldSpan } from "./field-group";

/** Each group as the profile always has it, so a setter's `fields` type follows the contract. */
type Groups = Required<ProfileDraft>;

export interface ProfileFieldsProps {
  draft: ProfileDraft;
  onChange: (next: ProfileDraft) => void;
}

/** Every profile field, grouped as the contract groups them. All of them are optional and clearable. */
export function ProfileFields({ draft, onChange }: ProfileFieldsProps) {
  const setExperience = (fields: Partial<Groups["experience"]>) =>
    onChange({ ...draft, experience: compactGroup({ ...draft.experience, ...fields }) });
  const setObjectives = (fields: Partial<Groups["objectives"]>) =>
    onChange({ ...draft, objectives: compactGroup({ ...draft.objectives, ...fields }) });
  const setRisk = (fields: Partial<Groups["risk"]>) =>
    onChange({ ...draft, risk: compactGroup({ ...draft.risk, ...fields }) });
  const setConstraints = (fields: Partial<Groups["constraints"]>) =>
    onChange({ ...draft, constraints: compactGroup({ ...draft.constraints, ...fields }) });
  const setJurisdiction = (fields: Partial<Groups["jurisdiction"]>) =>
    onChange({ ...draft, jurisdiction: compactGroup({ ...draft.jurisdiction, ...fields }) });
  const setStyle = (fields: Partial<Groups["style"]>) =>
    onChange({ ...draft, style: compactGroup({ ...draft.style, ...fields }) });

  return (
    <div className="space-y-5">
      <FieldGroup legend="Experience">
        <EnumField
          label="Experience level"
          value={draft.experience?.level}
          options={experienceLevels}
          onChange={(level) => setExperience({ level })}
        />
        <EnumField
          label="Role"
          value={draft.experience?.role}
          options={investorRoles}
          onChange={(role) => setExperience({ role })}
        />
      </FieldGroup>

      <Separator />

      <FieldGroup legend="Objectives">
        <EnumField
          label="Primary objective"
          value={draft.objectives?.primary}
          options={primaryObjectives}
          onChange={(primary) => setObjectives({ primary })}
        />
        <EnumField
          label="Investment horizon"
          value={draft.objectives?.horizon}
          options={horizons}
          onChange={(horizon) => setObjectives({ horizon })}
        />
      </FieldGroup>

      <Separator />

      <FieldGroup legend="Risk" description="Changes which risks are flagged, never what the evidence has to meet.">
        <EnumField
          label="Risk tolerance"
          value={draft.risk?.tolerance}
          options={riskTolerances}
          onChange={(tolerance) => setRisk({ tolerance })}
        />
        <EnumField
          label="Capacity for loss"
          value={draft.risk?.capacityForLoss}
          options={capacitiesForLoss}
          onChange={(capacityForLoss) => setRisk({ capacityForLoss })}
        />
        <EnumField
          label="Liquidity needs"
          value={draft.risk?.liquidityNeeds}
          options={liquidityLevels}
          onChange={(needs) => setRisk({ liquidityNeeds: needs })}
        />
      </FieldGroup>

      <Separator />

      <FieldGroup legend="Constraints">
        <FieldSpan>
          <CheckboxGroup
            legend="Allowed instruments"
            options={instrumentClasses}
            value={draft.constraints?.allowedInstruments ?? []}
            help="Leave everything unchecked to place no constraint on what the agent may discuss."
            onChange={(allowedInstruments) => setConstraints({ allowedInstruments })}
          />
        </FieldSpan>
        <FieldSpan>
          <TagInput
            label="Exclusions"
            value={draft.constraints?.exclusions}
            placeholder="tobacco"
            help="Sectors or themes to leave out, in your own words."
            onChange={(exclusions) => setConstraints({ exclusions })}
          />
        </FieldSpan>
      </FieldGroup>

      <Separator />

      <FieldGroup legend="Jurisdiction">
        <TextField
          label="Country"
          value={draft.jurisdiction?.country}
          placeholder="United States"
          onChange={(country) => setJurisdiction({ country })}
        />
        <TextField
          label="Tax residency"
          value={draft.jurisdiction?.taxResidency}
          placeholder="United States"
          onChange={(taxResidency) => setJurisdiction({ taxResidency })}
        />
        <TextField
          label="Base currency"
          value={draft.jurisdiction?.baseCurrency}
          placeholder="USD"
          help="The currency the agent reports in by default."
          onChange={(baseCurrency) => setJurisdiction({ baseCurrency })}
        />
        <FieldSpan>
          <TagInput
            label="Account types"
            value={draft.jurisdiction?.accountTypes}
            placeholder="Roth IRA"
            help="The wrappers you invest through, which change the tax angle of an answer."
            onChange={(accountTypes) => setJurisdiction({ accountTypes })}
          />
        </FieldSpan>
      </FieldGroup>

      <Separator />

      <FieldGroup legend="Style">
        <EnumField
          label="Investing approach"
          value={draft.style?.approach}
          options={investingApproaches}
          onChange={(approach) => setStyle({ approach })}
        />
        <EnumField
          label="Answer depth"
          value={draft.style?.depth}
          options={answerDepths}
          onChange={(depth) => setStyle({ depth })}
        />
        <TextField
          label="Answer language"
          value={draft.style?.answerLanguage}
          placeholder="English"
          onChange={(answerLanguage) => setStyle({ answerLanguage })}
        />
        <FieldSpan>
          <TagInput
            label="Preferred metrics"
            value={draft.style?.preferredMetrics}
            placeholder="free cash flow yield"
            help="Metrics you want to see first when they apply."
            onChange={(preferredMetrics) => setStyle({ preferredMetrics })}
          />
        </FieldSpan>
      </FieldGroup>
    </div>
  );
}
