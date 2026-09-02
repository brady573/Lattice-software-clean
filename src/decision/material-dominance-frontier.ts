import { z } from "zod";
import {
  priorityTierOrder,
  priorityTierSchema,
  type PriorityTier,
} from "./priority-and-requirements.js";
import {
  meaningfulDifferenceStateSchema,
  preferredSideSchema,
} from "./meaningful-difference.js";

export const frontierEligibilitySchema = z.enum([
  "ELIGIBLE",
  "INELIGIBLE",
  "UNKNOWN",
]);

export const frontierAlternativeSchema = z.object({
  alternativeId: z.string().trim().min(1).max(200),
  eligibility: frontierEligibilitySchema,
}).strict();

export const materialCriterionComparisonSchema = z.object({
  criterionId: z.string().trim().min(1).max(200),
  criterionVersion: z.number().int().positive(),
  tier: priorityTierSchema,
  state: meaningfulDifferenceStateSchema,
  preferredSide: preferredSideSchema,
}).strict().superRefine((comparison, context) => {
  if (comparison.state === "MEANINGFUL" && !["LEFT", "RIGHT"].includes(comparison.preferredSide)) {
    context.addIssue({
      code: "custom",
      path: ["preferredSide"],
      message: "A meaningful comparison must prefer LEFT or RIGHT.",
    });
  }
  if (comparison.state === "WITHIN_TOLERANCE" && comparison.preferredSide !== "NEITHER") {
    context.addIssue({
      code: "custom",
      path: ["preferredSide"],
      message: "A within-tolerance comparison must prefer NEITHER.",
    });
  }
  if (comparison.state === "UNKNOWN" && comparison.preferredSide !== "UNKNOWN") {
    context.addIssue({
      code: "custom",
      path: ["preferredSide"],
      message: "An unknown comparison must have UNKNOWN preference.",
    });
  }
});

export const pairwiseMaterialComparisonSchema = z.object({
  leftAlternativeId: z.string().trim().min(1).max(200),
  rightAlternativeId: z.string().trim().min(1).max(200),
  criteria: z.array(materialCriterionComparisonSchema).min(1),
}).strict().superRefine((comparison, context) => {
  if (comparison.leftAlternativeId === comparison.rightAlternativeId) {
    context.addIssue({
      code: "custom",
      path: ["rightAlternativeId"],
      message: "Pairwise comparison alternatives must be distinct.",
    });
  }
});

export const materialDominanceInputSchema = z.object({
  alternatives: z.array(frontierAlternativeSchema).min(1),
  comparisons: z.array(pairwiseMaterialComparisonSchema),
}).strict();

export type FrontierEligibility = z.infer<typeof frontierEligibilitySchema>;
export type FrontierAlternative = Readonly<z.infer<typeof frontierAlternativeSchema>>;
export type MaterialCriterionComparison = Readonly<z.infer<typeof materialCriterionComparisonSchema>>;
export type PairwiseMaterialComparison = Readonly<z.infer<typeof pairwiseMaterialComparisonSchema>>;
export type MaterialDominanceInput = Readonly<z.infer<typeof materialDominanceInputSchema>>;

export type PairwiseDecisionReason =
  | "LEFT_DOMINATES"
  | "RIGHT_DOMINATES"
  | "SAME_TIER_TRADE_OFF"
  | "UNRESOLVED_HIGHER_TIER"
  | "NO_MATERIAL_DIFFERENCE"
  | "COMPARISON_MISSING";

export interface FrontierExclusion {
  readonly alternativeId: string;
  readonly reason: "INELIGIBLE" | "ELIGIBILITY_UNKNOWN";
}

export interface PairwiseFrontierDecision {
  readonly leftAlternativeId: string;
  readonly rightAlternativeId: string;
  readonly dominantAlternativeId: string | null;
  readonly decisiveTier: PriorityTier | null;
  readonly reason: PairwiseDecisionReason;
  readonly materialAdvantages: readonly string[];
  readonly materialTradeOffs: readonly string[];
  readonly unresolvedCriteria: readonly string[];
}

export interface MaterialDominanceFrontier {
  readonly frontierAlternativeIds: readonly string[];
  readonly excludedAlternatives: readonly FrontierExclusion[];
  readonly pairwiseDecisions: readonly PairwiseFrontierDecision[];
  readonly forcedWinnerAlternativeId: null;
}

function pairKey(left: string, right: string): string {
  return [left, right].sort().join("\u0000");
}

function criterionKey(comparison: MaterialCriterionComparison): string {
  return `${comparison.criterionId}@${comparison.criterionVersion}`;
}

function orientComparison(
  comparison: PairwiseMaterialComparison,
  leftAlternativeId: string,
): PairwiseMaterialComparison {
  if (comparison.leftAlternativeId === leftAlternativeId) return comparison;
  return {
    leftAlternativeId: comparison.rightAlternativeId,
    rightAlternativeId: comparison.leftAlternativeId,
    criteria: comparison.criteria.map((criterion) => ({
      ...criterion,
      preferredSide: criterion.preferredSide === "LEFT"
        ? "RIGHT"
        : criterion.preferredSide === "RIGHT"
          ? "LEFT"
          : criterion.preferredSide,
    })),
  };
}

function decidePair(
  leftAlternativeId: string,
  rightAlternativeId: string,
  comparison: PairwiseMaterialComparison | undefined,
): PairwiseFrontierDecision {
  if (!comparison) {
    return Object.freeze({
      leftAlternativeId,
      rightAlternativeId,
      dominantAlternativeId: null,
      decisiveTier: null,
      reason: "COMPARISON_MISSING",
      materialAdvantages: Object.freeze([]),
      materialTradeOffs: Object.freeze([]),
      unresolvedCriteria: Object.freeze([]),
    });
  }

  const oriented = orientComparison(comparison, leftAlternativeId);
  for (const tier of priorityTierOrder) {
    const atTier = oriented.criteria.filter((criterion) => criterion.tier === tier);
    const unresolved = atTier
      .filter((criterion) => criterion.state === "UNKNOWN")
      .map(criterionKey);
    if (unresolved.length > 0) {
      return Object.freeze({
        leftAlternativeId,
        rightAlternativeId,
        dominantAlternativeId: null,
        decisiveTier: tier,
        reason: "UNRESOLVED_HIGHER_TIER",
        materialAdvantages: Object.freeze([]),
        materialTradeOffs: Object.freeze([]),
        unresolvedCriteria: Object.freeze(unresolved),
      });
    }

    const meaningful = atTier.filter((criterion) => criterion.state === "MEANINGFUL");
    if (meaningful.length === 0) continue;

    const leftAdvantages = meaningful
      .filter((criterion) => criterion.preferredSide === "LEFT")
      .map(criterionKey);
    const rightAdvantages = meaningful
      .filter((criterion) => criterion.preferredSide === "RIGHT")
      .map(criterionKey);

    if (leftAdvantages.length > 0 && rightAdvantages.length > 0) {
      return Object.freeze({
        leftAlternativeId,
        rightAlternativeId,
        dominantAlternativeId: null,
        decisiveTier: tier,
        reason: "SAME_TIER_TRADE_OFF",
        materialAdvantages: Object.freeze([]),
        materialTradeOffs: Object.freeze([...leftAdvantages, ...rightAdvantages]),
        unresolvedCriteria: Object.freeze([]),
      });
    }

    const leftDominates = leftAdvantages.length > 0;
    return Object.freeze({
      leftAlternativeId,
      rightAlternativeId,
      dominantAlternativeId: leftDominates ? leftAlternativeId : rightAlternativeId,
      decisiveTier: tier,
      reason: leftDominates ? "LEFT_DOMINATES" : "RIGHT_DOMINATES",
      materialAdvantages: Object.freeze(leftDominates ? leftAdvantages : rightAdvantages),
      materialTradeOffs: Object.freeze([]),
      unresolvedCriteria: Object.freeze([]),
    });
  }

  return Object.freeze({
    leftAlternativeId,
    rightAlternativeId,
    dominantAlternativeId: null,
    decisiveTier: null,
    reason: "NO_MATERIAL_DIFFERENCE",
    materialAdvantages: Object.freeze([]),
    materialTradeOffs: Object.freeze([]),
    unresolvedCriteria: Object.freeze([]),
  });
}

/**
 * Constructs the nondominated valid frontier without selecting a winner.
 *
 * Inputs are already-adjudicated eligibility and pairwise meaningful-difference
 * results. This function neither admits evidence nor interprets user intent.
 * Unknown or missing comparisons conservatively preserve alternatives.
 */
export function constructMaterialDominanceFrontier(
  inputValue: MaterialDominanceInput,
): MaterialDominanceFrontier {
  const input = materialDominanceInputSchema.parse(inputValue);
  const alternativeIds = new Set<string>();
  for (const alternative of input.alternatives) {
    if (alternativeIds.has(alternative.alternativeId)) {
      throw new Error(`Duplicate frontier alternative: ${alternative.alternativeId}.`);
    }
    alternativeIds.add(alternative.alternativeId);
  }

  const comparisons = new Map<string, PairwiseMaterialComparison>();
  for (const comparison of input.comparisons) {
    if (
      !alternativeIds.has(comparison.leftAlternativeId)
      || !alternativeIds.has(comparison.rightAlternativeId)
    ) {
      throw new Error("Pairwise comparison references an unknown alternative.");
    }
    const key = pairKey(comparison.leftAlternativeId, comparison.rightAlternativeId);
    if (comparisons.has(key)) {
      throw new Error(`Duplicate pairwise comparison: ${key.replace("\u0000", " vs ")}.`);
    }
    comparisons.set(key, comparison);
  }

  const eligible = input.alternatives
    .filter((alternative) => alternative.eligibility === "ELIGIBLE")
    .map((alternative) => alternative.alternativeId);
  const excludedAlternatives = input.alternatives
    .filter((alternative) => alternative.eligibility !== "ELIGIBLE")
    .map((alternative): FrontierExclusion => Object.freeze({
      alternativeId: alternative.alternativeId,
      reason: alternative.eligibility === "INELIGIBLE"
        ? "INELIGIBLE"
        : "ELIGIBILITY_UNKNOWN",
    }));

  const dominated = new Set<string>();
  const pairwiseDecisions: PairwiseFrontierDecision[] = [];
  for (let leftIndex = 0; leftIndex < eligible.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < eligible.length; rightIndex += 1) {
      const left = eligible[leftIndex]!;
      const right = eligible[rightIndex]!;
      const decision = decidePair(left, right, comparisons.get(pairKey(left, right)));
      pairwiseDecisions.push(decision);
      if (decision.dominantAlternativeId === left) dominated.add(right);
      if (decision.dominantAlternativeId === right) dominated.add(left);
    }
  }

  return Object.freeze({
    frontierAlternativeIds: Object.freeze(eligible.filter((id) => !dominated.has(id))),
    excludedAlternatives: Object.freeze(excludedAlternatives),
    pairwiseDecisions: Object.freeze(pairwiseDecisions),
    forcedWinnerAlternativeId: null,
  });
}
