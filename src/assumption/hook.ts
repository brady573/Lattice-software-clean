/**
 * Advisory-path integration hook for the Assumption Guard (DP-002/DP-004).
 *
 * Runs after Solandra advisory reasoning produces a RECOMMENDATION and before
 * that conclusion is finalized (persisted via establish*Recommendation and
 * presented). Because every downstream consumer (choice selection, the action
 * preparer, the Action Engine) reads the finalized recommendation, gating
 * finalization gates all Action Engine consumption too.
 *
 * ADDITIVE CONSUMPTION ONLY: this hook reads the existing advisory shape and
 * the already-loaded governed uncertainties. It changes no governed path, no
 * V36 admission, no store, and no cognition/advisory contract shape. When it
 * clears — the common case — the caller proceeds with the byte-identical
 * advisory result it already held.
 *
 * Candidacy (what gets evaluated): a model-surfaced uncertainty item that is
 * NOT a restatement of already-governed uncertainty (compared with the
 * canonical comparison key, so whitespace/dash repairs never count as novel)
 * AND that Solandra explicitly addressed to the user as an unresolved
 * question (trimmed text ends with "?"). The "?" test is structural routing
 * of Solandra's own output contract, not interpretation of USER language:
 * Solandra put an open question inside this conclusion's uncertainties, so a
 * responsible gate asks it up front instead of burying it in
 * "What remains uncertain". Drafting explanations without a user-directed
 * question stay cleared: they are already surfaced downstream, and escalating
 * them would manufacture UX friction from non-material prose.
 */

import type { SolandraRecommendationResult } from "../solandra/advisory.js";
import {
  canonicalUncertaintyKey,
  canonicalUncertaintySet,
} from "../string/uncertainty-canonical.js";
import { guardAssumptions } from "./guard.js";
import type {
  AssumptionCandidate,
  AssumptionGuardOutput,
} from "./types.js";

export interface AdvisoryAssumptionScreeningInput {
  readonly recommendation: SolandraRecommendationResult;
  readonly governedUncertainties: readonly string[];
}

export interface AdvisoryAssumptionScreening {
  /**
   * True when conclusion finalization may proceed. True covers both "no
   * material dependency" and "material, but nothing user-askable" — in the
   * latter case the dependencies are already surfaced as uncertainty
   * downstream, so blocking would add friction without new information.
   */
  readonly cleared: boolean;
  /** The advisory result to finalize (unchanged reference when cleared). */
  readonly recommendation: SolandraRecommendationResult;
  /** Full guard evaluation, for observability and tests. */
  readonly guard: AssumptionGuardOutput;
  /** Single natural question. Present only when escalation is warranted. */
  readonly question?: string;
}

export function guardAdvisoryConclusion(
  input: AdvisoryAssumptionScreeningInput,
): AdvisoryAssumptionScreening {
  const covered = canonicalUncertaintySet(input.governedUncertainties);
  const blocking = input.recommendation.uncertainties
    .filter((item) => !covered.has(canonicalUncertaintyKey(item)))
    .filter((item) => item.trim().endsWith("?"));

  // The advisory boundary carries no numeric confidence, and this hook must
  // not invent one: both confidence fields are 1 so the numerics claim
  // nothing, while bearsOnConfidence records the honest structural fact —
  // Solandra listed this item as an uncertainty OF THIS recommendation, so an
  // adverse answer could change the expressed confidence. Weakening is carried
  // in prose per the calibrated-language rules, never as a number to the user.
  const candidates: AssumptionCandidate[] = blocking.map((statement) => ({
    statement,
    support: "UNKNOWN",
    confidenceIfTrue: 1,
    confidenceIfFalse: 1,
    bearsOnConfidence: true,
    affectsConclusion: false,
    affectsAction: false,
  }));
  const guard = guardAssumptions({
    conclusion: input.recommendation.recommendation,
    expressedConfidence: 1,
    candidates,
  });

  if (guard.cleared || guard.question === undefined) {
    return { cleared: true, recommendation: input.recommendation, guard };
  }
  return {
    cleared: false,
    recommendation: input.recommendation,
    guard,
    question: guard.question,
  };
}
