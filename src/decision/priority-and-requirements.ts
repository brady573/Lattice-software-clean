import { z } from "zod";

export const priorityTierSchema = z.enum([
  "MUST_HAVE",
  "MATTERS_MOST",
  "IMPORTANT",
  "NICE_TO_HAVE",
]);

export const priorityTierOrder = Object.freeze([
  "MUST_HAVE",
  "MATTERS_MOST",
  "IMPORTANT",
  "NICE_TO_HAVE",
] as const satisfies readonly PriorityTier[]);

export const hardRequirementStateSchema = z.enum([
  "SATISFIED",
  "FAILED",
  "UNKNOWN",
]);

export const hardRequirementOperatorSchema = z.enum(["LTE", "GTE", "EQ"]);

export const hardRequirementSchema = z.object({
  criterionId: z.string().trim().min(1).max(200),
  criterionVersion: z.number().int().positive(),
  operator: hardRequirementOperatorSchema,
  expected: z.union([z.number().finite(), z.string(), z.boolean()]),
}).strict();

export type PriorityTier = z.infer<typeof priorityTierSchema>;
export type HardRequirementState = z.infer<typeof hardRequirementStateSchema>;
export type HardRequirementOperator = z.infer<typeof hardRequirementOperatorSchema>;
export type HardRequirement = Readonly<z.infer<typeof hardRequirementSchema>>;
export type HardRequirementObservedValue = number | string | boolean | null;

const priorityRank: Readonly<Record<PriorityTier, number>> = Object.freeze({
  MUST_HAVE: 0,
  MATTERS_MOST: 1,
  IMPORTANT: 2,
  NICE_TO_HAVE: 3,
});

export function comparePriorityTiers(left: PriorityTier, right: PriorityTier): number {
  return priorityRank[left] - priorityRank[right];
}

function valuesHaveSameType(
  observed: Exclude<HardRequirementObservedValue, null>,
  expected: HardRequirement["expected"],
): boolean {
  return typeof observed === typeof expected;
}

/**
 * Evaluates only the Decision Engine hard-requirement predicate.
 *
 * A missing or non-comparable admitted value is UNKNOWN. This function does not
 * admit evidence or decide whether further research is required; those remain
 * V36 responsibilities.
 */
export function evaluateHardRequirement(
  requirementInput: HardRequirement,
  observed: HardRequirementObservedValue,
): HardRequirementState {
  const requirement = hardRequirementSchema.parse(requirementInput);
  if (observed === null || !valuesHaveSameType(observed, requirement.expected)) {
    return "UNKNOWN";
  }

  switch (requirement.operator) {
    case "EQ":
      return observed === requirement.expected ? "SATISFIED" : "FAILED";
    case "LTE":
      if (typeof observed !== "number" || typeof requirement.expected !== "number") return "UNKNOWN";
      return observed <= requirement.expected ? "SATISFIED" : "FAILED";
    case "GTE":
      if (typeof observed !== "number" || typeof requirement.expected !== "number") return "UNKNOWN";
      return observed >= requirement.expected ? "SATISFIED" : "FAILED";
  }
}

export function hardRequirementsPermitEligibility(
  states: readonly HardRequirementState[],
): boolean {
  return states.every((state) => state === "SATISFIED");
}
