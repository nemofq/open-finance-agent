/**
 * What the "Add provider" dialog lists: the featured rows under their three headings, the rest by
 * category behind "More providers", or every row matching a search, each with the reason it cannot
 * be used, if any. A company's regional editions share one row until one is picked. Pure, so the
 * ordering, the grouping and the reasons can be tested.
 */
import type { LlmProviderConfig } from "@/lib/config/schema";
import { canAddProvider, catalogEntries, type LlmCatalogEntry, llmProviderCatalog, providerAuthKind } from "@/lib/llm/catalog";
import {
  llmProviderCategories,
  type LlmProviderCategory,
  type LlmProviderFamily,
  llmProviderFamilies,
} from "@/lib/llm/provider-types";

export interface ProviderOption {
  entry: LlmCatalogEntry;
  /** Why this row cannot be used, or null when it can. */
  disabledReason: string | null;
}

/** A company with several editions: one row, whose editions are picked on the next step. */
export interface ProviderFamilyOption {
  id: LlmProviderFamily;
  name: string;
  description: string;
  /** The editions, in table order, each titled by its variant. */
  options: ProviderOption[];
  /** Set only when no edition can be added any more. */
  disabledReason: string | null;
}

export type ProviderListItem =
  | { kind: "entry"; option: ProviderOption }
  | { kind: "family"; family: ProviderFamilyOption };

export interface ProviderSection {
  id: string;
  title: string;
  description?: string;
  items: ProviderListItem[];
}

/** The featured headings, in the order they are shown. */
const FEATURED: readonly (Omit<ProviderSection, "items"> & { id: LlmCatalogEntry["group"] })[] = [
  {
    id: "signin",
    title: "Sign in",
    description: "Use a subscription you already pay for. The sign-in is stored on this machine.",
  },
  { id: "api_key", title: "API key", description: "Pay with a key you create at the provider." },
  { id: "custom", title: "Custom endpoint", description: "Your own server or a gateway that speaks the OpenAI API." },
];

/** The "More providers" headings: the sign-ins first, then each category. */
const MORE: readonly { id: "signin" | LlmProviderCategory; title: string }[] = [
  { id: "signin", title: "Sign in" },
  ...(["maker", "host", "gateway", "cloud"] as const).map((id) => ({ id, title: llmProviderCategories[id] })),
];

/**
 * The line shown on a row for a provider that is already configured. A type has one instance
 * however it was added, so the sign-in row of a keyed provider says which way it was taken.
 */
function disabledReason(entry: LlmCatalogEntry, providers: LlmProviderConfig[]): string | null {
  if (canAddProvider(entry.type, providers)) return null;
  const existing = providers.find((provider) => provider.type === entry.type);
  if (!existing || providerAuthKind(existing) === entry.auth) return "Already added";
  return providerAuthKind(existing) === "oauth" ? "Added as a sign-in" : "Added with an API key";
}

/**
 * The options as list items, in order, with each family's editions gathered into one item where
 * its first edition sits. Editions reached by a sign-in stay rows of their own.
 */
function toItems(options: ProviderOption[]): ProviderListItem[] {
  const families = new Map<LlmProviderFamily, ProviderFamilyOption>();
  return options.flatMap((option): ProviderListItem[] => {
    const family = option.entry.family;
    if (!family || option.entry.auth === "oauth") return [{ kind: "entry", option }];
    const known = families.get(family.id);
    if (known) {
      known.options.push(option);
      known.disabledReason = known.options.every((each) => each.disabledReason) ? "Already added" : null;
      return [];
    }
    const created: ProviderFamilyOption = {
      id: family.id,
      ...llmProviderFamilies[family.id],
      options: [option],
      disabledReason: option.disabledReason ? "Already added" : null,
    };
    families.set(family.id, created);
    return [{ kind: "family", family: created }];
  });
}

/** A family of one edition is just that edition. */
function flatten(item: ProviderListItem): ProviderListItem {
  return item.kind === "family" && item.family.options.length === 1
    ? { kind: "entry", option: item.family.options[0] }
    : item;
}

/** Every word of the query appears in the row's name, description, id, company, edition or heading. */
export function matchesQuery(entry: LlmCatalogEntry, query: string): boolean {
  const haystack = [
    entry.name,
    entry.description,
    entry.type,
    entry.family ? llmProviderFamilies[entry.family.id].name : "",
    entry.family?.variant ?? "",
    entry.auth === "oauth" ? "sign in subscription" : "api key",
    llmProviderCategories[entry.category],
  ]
    .join(" ")
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

export interface ProviderList {
  /** Shown before "More providers" is opened. */
  featured: ProviderSection[];
  /** Behind "More providers". */
  more: ProviderSection[];
  /** How many rows "More providers" holds, a company counted once. */
  moreCount: number;
}

/** Every way a provider can be added, sorted into the featured headings and the "More providers" ones. */
export function providerList(
  providers: LlmProviderConfig[],
  entries: LlmCatalogEntry[] = catalogEntries,
): ProviderList {
  const options = entries.map((entry) => ({ entry, disabledReason: disabledReason(entry, providers) }));
  const sections = (
    headings: readonly Omit<ProviderSection, "items">[],
    pick: (option: ProviderOption, heading: string) => boolean,
  ): ProviderSection[] =>
    headings.flatMap((heading) => {
      const items = toItems(options.filter((option) => pick(option, heading.id))).map(flatten);
      return items.length > 0 ? [{ ...heading, items }] : [];
    });
  const featured = sections(FEATURED, ({ entry }, id) => entry.featured && entry.group === id);
  const more = sections(MORE, ({ entry }, id) =>
    !entry.featured && (entry.auth === "oauth" ? id === "signin" : entry.category === id),
  );
  return { featured, more, moreCount: more.reduce((sum, section) => sum + section.items.length, 0) };
}

/**
 * Every row matching `query`, featured rows first, each edition a row of its own so a search for a
 * region lands on it. Empty when nothing matches.
 */
export function searchProviders(
  providers: LlmProviderConfig[],
  query: string,
  entries: LlmCatalogEntry[] = catalogEntries,
): ProviderOption[] {
  const matches = entries.filter((entry) => matchesQuery(entry, query));
  const ordered = [...matches.filter((entry) => entry.featured), ...matches.filter((entry) => !entry.featured)];
  return ordered.map((entry) => ({ entry, disabledReason: disabledReason(entry, providers) }));
}

/** A company's editions, for the step that picks one: every key row of the family, in table order. */
export function familyOptions(
  providers: LlmProviderConfig[],
  family: LlmProviderFamily,
  entries: LlmCatalogEntry[] = catalogEntries,
): ProviderOption[] {
  return entries
    .filter((entry) => entry.family?.id === family && entry.auth !== "oauth")
    .map((entry) => ({ entry, disabledReason: disabledReason(entry, providers) }));
}

/**
 * The caveat under an experimental row, naming the company behind it. Anthropic has been
 * restricting subscription tokens outside its own clients, and Meta's sign-in borrows the Muse
 * Code CLI's client id, so the key row is the dependable one.
 */
export function experimentalCaveat(entry: LlmCatalogEntry): string {
  const company = llmProviderCatalog[entry.type].name;
  return `${company} may limit subscription sign-in from other apps at any time; an API key is the dependable route.`;
}
