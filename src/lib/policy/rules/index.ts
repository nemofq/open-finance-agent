import type { AfterToolRule, BeforeStopRule, BeforeToolRule } from "../events";
import { p1TrustedSourcesFirst } from "./trusted-sources";
import { p2DuplicateDataCall } from "./reuse-evidence";
import { p3PersonalDataLeaving } from "./private-data";
import { p4StaleQuote } from "./stale-quotes";
import { p5ConflictUnmentioned, p5SourcesDisagree } from "./source-conflicts";
import { p6UndeclaredConstants } from "./calculator-assumptions";
import { p8UnsourcedFigures } from "./answer-grounding";
import { p9UnverifiedFigures } from "./weak-sources";
import { p11RecommendationWording } from "./recommendation-language";
import { p13LookAhead } from "./look-ahead";

/**
 * The default policy, in the order it runs. Privacy comes before routing, and a
 * duplicate call is served before anything else decides where the data should come from.
 */

export const BEFORE_TOOL_RULES: readonly BeforeToolRule[] = [
  p3PersonalDataLeaving,
  p2DuplicateDataCall,
  p1TrustedSourcesFirst,
];

export const AFTER_TOOL_RULES: readonly AfterToolRule[] = [
  p4StaleQuote,
  p5SourcesDisagree,
  p6UndeclaredConstants,
  p13LookAhead,
];

export const BEFORE_STOP_RULES: readonly BeforeStopRule[] = [
  p8UnsourcedFigures,
  p5ConflictUnmentioned,
  p9UnverifiedFigures,
  p11RecommendationWording,
];
