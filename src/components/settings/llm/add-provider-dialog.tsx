"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cn } from "cn";
import { ChevronDownIcon, ChevronRightIcon, ChevronUpIcon, SearchIcon } from "lucide-react";
import { StatusLine } from "@/components/shared/field-row";
import { deepEqual } from "@/lib/utils";
import { PendingButton } from "@/components/shared/pending-button";
import { useUnsavedChangesWarning } from "@/components/shared/use-unsaved-changes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { LlmProviderConfig } from "@/lib/config/schema";
import { createProvider, type LlmCatalogEntry, llmProviderCatalog, newProviderId } from "@/lib/llm/catalog";
import { type LlmProviderFamily, llmProviderFamilies } from "@/lib/llm/provider-types";
import {
  experimentalCaveat,
  familyOptions,
  type ProviderFamilyOption,
  providerList,
  type ProviderOption,
  type ProviderSection,
  searchProviders,
} from "./add-options";
import { isHttpUrl, normalizeBaseUrl } from "./drafts";
import { EndpointFields, type EndpointDraft } from "./endpoint-fields";

const emptyEndpoint: EndpointDraft = { name: "", baseUrl: "", apiKey: "" };

/** One column on a phone, two once the dialog is wide enough for rows to keep their descriptions readable. */
const gridClass = "grid grid-cols-1 gap-2 md:grid-cols-2";

const rowClass =
  "flex h-full w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent";

/** What a row ends with: a chevron while it can be chosen, else why it cannot. */
function RowEnd({ disabledReason }: { disabledReason: string | null }) {
  return disabledReason === null ? (
    <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
  ) : (
    <Badge variant="secondary">{disabledReason}</Badge>
  );
}

function ProviderRow({
  option: { entry, disabledReason },
  title = entry.name,
  showAuth = false,
  disabled,
  onChoose,
}: {
  option: ProviderOption;
  /** The row's title; an edition in a company's step is titled by its variant. */
  title?: string;
  /** Mark a sign-in row, where no heading says that it is one. */
  showAuth?: boolean;
  /** True while a chosen provider is being added. */
  disabled: boolean;
  onChoose: (entry: LlmCatalogEntry) => void;
}) {
  return (
    <li className="min-w-0">
      <button
        type="button"
        disabled={disabledReason !== null || disabled}
        onClick={() => onChoose(entry)}
        className={rowClass}
      >
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{title}</span>
            {showAuth && entry.auth === "oauth" ? <Badge variant="outline">Sign in</Badge> : null}
            {entry.experimental ? <Badge variant="outline">Experimental</Badge> : null}
          </span>
          <span className="block text-xs leading-relaxed text-muted-foreground">{entry.description}</span>
          {entry.experimental ? (
            <span className="block text-xs leading-relaxed text-muted-foreground">{experimentalCaveat(entry)}</span>
          ) : null}
        </span>
        <RowEnd disabledReason={disabledReason} />
      </button>
    </li>
  );
}

/** A company with several editions; choosing it moves to the step that picks one. */
function FamilyRow({
  family,
  disabled,
  onOpen,
}: {
  family: ProviderFamilyOption;
  disabled: boolean;
  onOpen: (family: LlmProviderFamily) => void;
}) {
  return (
    <li className="min-w-0">
      <button
        type="button"
        disabled={family.disabledReason !== null || disabled}
        onClick={() => onOpen(family.id)}
        className={rowClass}
      >
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{family.name}</span>
            <Badge variant="outline">{family.options.length} editions</Badge>
          </span>
          <span className="block text-xs leading-relaxed text-muted-foreground">{family.description}</span>
        </span>
        <RowEnd disabledReason={family.disabledReason} />
      </button>
    </li>
  );
}

interface ChooseHandlers {
  disabled: boolean;
  onChoose: (entry: LlmCatalogEntry) => void;
  onOpenFamily: (family: LlmProviderFamily) => void;
}

function Sections({ sections, showAuth, ...handlers }: { sections: ProviderSection[]; showAuth: boolean } & ChooseHandlers) {
  return sections.map((section) => (
    <section key={section.id} className="space-y-2">
      <div className="space-y-0.5">
        <h3 className="text-sm font-medium">{section.title}</h3>
        {section.description ? (
          <p className="text-xs leading-relaxed text-muted-foreground">{section.description}</p>
        ) : null}
      </div>
      <ul className={gridClass}>
        {section.items.map((item) =>
          item.kind === "family" ? (
            <FamilyRow key={item.family.id} family={item.family} disabled={handlers.disabled} onOpen={handlers.onOpenFamily} />
          ) : (
            <ProviderRow
              key={item.option.entry.id}
              option={item.option}
              showAuth={showAuth}
              disabled={handlers.disabled}
              onChoose={handlers.onChoose}
            />
          ),
        )}
      </ul>
    </section>
  ));
}

/**
 * The catalog: the featured providers under their three headings, the rest behind "More providers"
 * by category, and a search over all of them.
 */
function ProviderTypeList({
  providers,
  query,
  onQueryChange,
  expanded,
  onExpandedChange,
  ...handlers
}: {
  providers: LlmProviderConfig[];
  query: string;
  onQueryChange: (query: string) => void;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
} & ChooseHandlers) {
  const moreId = useId();
  const toggleRef = useRef<HTMLDivElement>(null);
  // Set by the click that opens More, so the list scrolls to what it opened only then, not when the dialog opens.
  const scrollOnExpand = useRef(false);

  useEffect(() => {
    if (!expanded || !scrollOnExpand.current) return;
    scrollOnExpand.current = false;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    toggleRef.current?.scrollIntoView({ block: "start", behavior: still ? "auto" : "smooth" });
  }, [expanded]);

  const searching = query.trim() !== "";
  const list = providerList(providers);
  const results = searching ? searchProviders(providers, query) : [];

  return (
    <div className="space-y-5">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          aria-label="Search providers"
          className="pl-8"
          placeholder="Search providers"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </div>
      {searching ? (
        results.length > 0 ? (
          <ul className={gridClass} aria-label="Matching providers">
            {results.map((option) => (
              <ProviderRow
                key={option.entry.id}
                option={option}
                showAuth
                disabled={handlers.disabled}
                onChoose={handlers.onChoose}
              />
            ))}
          </ul>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              No provider matches “{query.trim()}”. Any server that speaks the OpenAI API can still be added as an
              endpoint.
            </p>
            <Button type="button" variant="outline" onClick={() => onQueryChange("")}>
              Clear search
            </Button>
          </div>
        )
      ) : (
        <>
          <Sections sections={list.featured} showAuth={false} {...handlers} />
          <div ref={toggleRef} className="scroll-mt-2 border-t pt-3">
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              aria-expanded={expanded}
              aria-controls={moreId}
              onClick={() => {
                scrollOnExpand.current = !expanded;
                onExpandedChange(!expanded);
              }}
            >
              {expanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
              {expanded ? "Fewer providers" : `More providers (${list.moreCount})`}
            </Button>
          </div>
          {expanded ? (
            <div id={moreId} className="space-y-5">
              <Sections sections={list.more} showAuth={false} {...handlers} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

export interface AddProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providers: LlmProviderConfig[];
  /** Persist the new provider; resolves true once saved, which closes the dialog, or reports why to `onError`. */
  onAdd: (provider: LlmProviderConfig, onError: (message: string) => void) => Promise<boolean>;
}

/**
 * Pick a way to add a provider. Hosted providers are saved straight away — the page then opens the
 * connect dialog for one that signs in; a company with regional editions asks which one first, and
 * an endpoint asks for its name, URL and key. The step, the search and whether "More providers" is
 * open live in state, so remount (change `key`) on every open.
 */
export function AddProviderDialog({ open, onOpenChange, providers, onAdd }: AddProviderDialogProps) {
  const [endpoint, setEndpoint] = useState<EndpointDraft | null>(null);
  const [family, setFamily] = useState<LlmProviderFamily | null>(null);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const takenIds = providers.map((provider) => provider.id);

  // The modal blocks in-app links, so this guards closing or reloading the tab and the New chat shortcut.
  useUnsavedChangesWarning(open && endpoint !== null && !deepEqual(endpoint, emptyEndpoint));

  const add = async (provider: LlmProviderConfig) => {
    setAdding(true);
    setError(null);
    if (await onAdd(provider, setError)) onOpenChange(false);
    else setAdding(false);
  };

  const choose = (entry: LlmCatalogEntry) => {
    if (entry.type === "openai-compatible") setEndpoint(emptyEndpoint);
    else void add(createProvider(entry, takenIds));
  };

  const back = () => {
    setEndpoint(null);
    setFamily(null);
    setError(null);
  };

  const addEndpoint = (draft: EndpointDraft) => {
    const name = draft.name.trim();
    void add({
      id: newProviderId("openai-compatible", name, takenIds),
      type: "openai-compatible",
      name,
      apiKey: draft.apiKey,
      baseUrl: normalizeBaseUrl(draft.baseUrl),
      models: [],
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !adding && onOpenChange(next)}>
      <DialogContent
        className={cn("max-h-[85vh] overflow-y-auto", endpoint ? "sm:max-w-md" : "sm:max-w-md md:max-w-3xl")}
      >
        {endpoint ? (
          <>
            <DialogHeader>
              <DialogTitle>Add {llmProviderCatalog["openai-compatible"].name}</DialogTitle>
              <DialogDescription>
                Any server that speaks the OpenAI Chat Completions API. List its models after adding it.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <EndpointFields value={endpoint} onChange={(fields) => setEndpoint({ ...endpoint, ...fields })} />
              {error ? <StatusLine ok={false}>{error}</StatusLine> : null}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={back} disabled={adding}>
                Back
              </Button>
              <PendingButton
                onClick={() => addEndpoint(endpoint)}
                pending={adding}
                disabled={!endpoint.name.trim() || !isHttpUrl(endpoint.baseUrl)}
              >
                Add endpoint
              </PendingButton>
            </DialogFooter>
          </>
        ) : family ? (
          <>
            <DialogHeader>
              <DialogTitle>Add {llmProviderFamilies[family].name}</DialogTitle>
              <DialogDescription>
                Pick the edition your account is on. Each has its own keys, which do not work on the others.
              </DialogDescription>
            </DialogHeader>
            <ul className={gridClass}>
              {familyOptions(providers, family).map((option) => (
                <ProviderRow
                  key={option.entry.id}
                  option={option}
                  title={option.entry.family?.variant}
                  disabled={adding}
                  onChoose={choose}
                />
              ))}
            </ul>
            {error ? <StatusLine ok={false}>{error}</StatusLine> : null}
            <DialogFooter>
              <Button variant="outline" onClick={back} disabled={adding}>
                Back
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Add provider</DialogTitle>
              <DialogDescription>Where the agent&apos;s models come from. You can add several.</DialogDescription>
            </DialogHeader>
            <ProviderTypeList
              providers={providers}
              query={query}
              onQueryChange={setQuery}
              expanded={expanded}
              onExpandedChange={setExpanded}
              disabled={adding}
              onChoose={choose}
              onOpenFamily={setFamily}
            />
            {error ? <StatusLine ok={false}>{error}</StatusLine> : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
