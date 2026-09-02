import { z } from "zod";
import {
  criterionDefinitionSchema,
  type CriterionDefinition,
} from "./criterion-catalog.js";

export const userCriterionToleranceSchema = z.object({
  intentScopeId: z.string().trim().min(1).max(200),
  intentVersionId: z.string().trim().min(1).max(200),
  criterionId: z.string().trim().min(1).max(200),
  criterionVersion: z.number().int().positive(),
  kind: z.literal("ABSOLUTE"),
  maximumDifference: z.number().finite().nonnegative(),
}).strict();

export const meaningfulDifferenceStateSchema = z.enum([
  "MEANINGFUL",
  "WITHIN_TOLERANCE",
  "UNKNOWN",
]);

export const preferredSideSchema = z.enum(["LEFT", "RIGHT", "NEITHER", "UNKNOWN"]);

export type UserCriterionTolerance = Readonly<z.infer<typeof userCriterionToleranceSchema>>;
export type MeaningfulDifferenceState = z.infer<typeof meaningfulDifferenceStateSchema>;
export type PreferredSide = z.infer<typeof preferredSideSchema>;

export interface MeaningfulDifferenceEvaluation {
  readonly criterionId: string;
  readonly criterionVersion: number;
  readonly intentScopeId: string | null;
  readonly intentVersionId: string | null;
  readonly state: MeaningfulDifferenceState;
  readonly preferredSide: PreferredSide;
  readonly absoluteDifference: number | null;
  readonly criterionMinimumDifference: number;
  readonly userMaximumDifference: number | null;
}

function assertMatchingTolerance(
  definition: CriterionDefinition,
  tolerance: UserCriterionTolerance,
): void {
  if (
    tolerance.criterionId !== definition.criterionId
    || tolerance.criterionVersion !== definition.version
  ) {
    throw new Error(
      `User tolerance ${tolerance.criterionId}@${tolerance.criterionVersion} does not match `
      + `CriterionDefinition ${definition.criterionId}@${definition.version}.`,
    );
  }
}

function unknownEvaluation(
  definition: CriterionDefinition,
  tolerance: UserCriterionTolerance | null,
): MeaningfulDifferenceEvaluation {
  return Object.freeze({
    criterionId: definition.criterionId,
    criterionVersion: definition.version,
    intentScopeId: tolerance?.intentScopeId ?? null,
    intentVersionId: tolerance?.intentVersionId ?? null,
    state: "UNKNOWN",
    preferredSide: "UNKNOWN",
    absoluteDifference: null,
    criterionMinimumDifference: definition.meaningfulDifference.minimum,
    userMaximumDifference: tolerance?.maximumDifference ?? null,
  });
}

/**
 * Compares two admitted numeric values while conserving tolerance ownership.
 *
 * CriterionDefinition supplies the domain minimum meaningful difference. An optional
 * exact-IntentVersion projection supplies the USER's maximum tolerated difference.
 * The Decision Engine combines them only for comparison; it does not create or mutate
 * either authority.
 */
export function evaluateMeaningfulDifference(
  definitionInput: CriterionDefinition,
  leftValue: number | null,
  rightValue: number | null,
  toleranceInput: UserCriterionTolerance | null = null,
): MeaningfulDifferenceEvaluation {
  const definition = criterionDefinitionSchema.parse(definitionInput);
  const tolerance = toleranceInput === null
    ? null
    : userCriterionToleranceSchema.parse(toleranceInput);

  if (tolerance) assertMatchingTolerance(definition, tolerance);

  if (
    definition.valueType !== "NUMBER"
    || definition.preferenceDirection === "MATCH_ONLY"
    || leftValue === null
    || rightValue === null
    || !Number.isFinite(leftValue)
    || !Number.isFinite(rightValue)
  ) {
    return unknownEvaluation(definition, tolerance);
  }

  const absoluteDifference = Math.abs(leftValue - rightValue);
  const domainMeaningful = absoluteDifference >= definition.meaningfulDifference.minimum;
  const outsideUserTolerance = tolerance === null
    || absoluteDifference > tolerance.maximumDifference;
  const meaningful = absoluteDifference > 0 && domainMeaningful && outsideUserTolerance;

  let preferredSide: PreferredSide = "NEITHER";
  if (meaningful) {
    const leftPreferred = definition.preferenceDirection === "HIGHER_IS_BETTER"
      ? leftValue > rightValue
      : leftValue < rightValue;
    preferredSide = leftPreferred ? "LEFT" : "RIGHT";
  }

  return Object.freeze({
    criterionId: definition.criterionId,
    criterionVersion: definition.version,
    intentScopeId: tolerance?.intentScopeId ?? null,
    intentVersionId: tolerance?.intentVersionId ?? null,
    state: meaningful ? "MEANINGFUL" : "WITHIN_TOLERANCE",
    preferredSide,
    absoluteDifference,
    criterionMinimumDifference: definition.meaningfulDifference.minimum,
    userMaximumDifference: tolerance?.maximumDifference ?? null,
  });
}
