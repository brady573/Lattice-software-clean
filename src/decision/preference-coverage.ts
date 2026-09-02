import { z } from "zod";

export const preferenceCoverageStateSchema = z.enum([
  "COMPLETE",
  "PARTIAL",
  "NONE",
]);

export const unresolvedPreferenceGapSchema = z.enum([
  "NONE",
  "EVIDENCE",
  "INTENT",
  "IRRESOLVABLE",
]);

export const preferenceResolutionOwnerSchema = z.enum([
  "NONE",
  "V36",
  "INTENT_AUTHORITY",
  "EXPLICIT_LIMITATION",
]);

export const preferenceEvaluationInputSchema = z.object({
  criterionId: z.string().trim().min(1).max(200),
  criterionVersion: z.number().int().positive(),
  utility: z.number().finite().min(0).max(1).nullable(),
  coverage: preferenceCoverageStateSchema,
  unresolvedGap: unresolvedPreferenceGapSchema,
}).strict().superRefine((input, context) => {
  if (input.utility === null && input.unresolvedGap === "NONE") {
    context.addIssue({
      code: "custom",
      path: ["unresolvedGap"],
      message: "Unknown preference utility requires an explicit unresolved gap.",
    });
  }
  if (input.coverage === "COMPLETE" && input.unresolvedGap === "EVIDENCE") {
    context.addIssue({
      code: "custom",
      path: ["coverage"],
      message: "Complete coverage cannot carry an unresolved evidence gap.",
    });
  }
  if (input.coverage === "NONE" && input.utility !== null) {
    context.addIssue({
      code: "custom",
      path: ["utility"],
      message: "Preference utility cannot be known when coverage is NONE.",
    });
  }
});

export type PreferenceCoverageState = z.infer<typeof preferenceCoverageStateSchema>;
export type UnresolvedPreferenceGap = z.infer<typeof unresolvedPreferenceGapSchema>;
export type PreferenceResolutionOwner = z.infer<typeof preferenceResolutionOwnerSchema>;
export type PreferenceEvaluationInput = Readonly<z.infer<typeof preferenceEvaluationInputSchema>>;

export interface PreferenceCoverageEvaluation {
  readonly criterionId: string;
  readonly criterionVersion: number;
  readonly utility: number | null;
  readonly utilityState: "KNOWN" | "UNKNOWN";
  readonly coverage: PreferenceCoverageState;
  readonly unresolvedGap: UnresolvedPreferenceGap;
  readonly resolutionOwner: PreferenceResolutionOwner;
  readonly rankingStable: boolean;
}

function resolutionOwnerFor(gap: UnresolvedPreferenceGap): PreferenceResolutionOwner {
  switch (gap) {
    case "NONE": return "NONE";
    case "EVIDENCE": return "V36";
    case "INTENT": return "INTENT_AUTHORITY";
    case "IRRESOLVABLE": return "EXPLICIT_LIMITATION";
  }
}

/**
 * Conserves utility, coverage, and unresolved-gap authority as separate state.
 *
 * Unknown utility remains null and is never converted to zero. Resolution routing
 * identifies the owning authority without performing research, clarification, or
 * limitation presentation.
 */
export function evaluatePreferenceCoverage(
  inputValue: PreferenceEvaluationInput,
): PreferenceCoverageEvaluation {
  const input = preferenceEvaluationInputSchema.parse(inputValue);
  const resolutionOwner = resolutionOwnerFor(input.unresolvedGap);
  return Object.freeze({
    criterionId: input.criterionId,
    criterionVersion: input.criterionVersion,
    utility: input.utility,
    utilityState: input.utility === null ? "UNKNOWN" : "KNOWN",
    coverage: input.coverage,
    unresolvedGap: input.unresolvedGap,
    resolutionOwner,
    rankingStable: input.utility !== null
      && input.coverage === "COMPLETE"
      && input.unresolvedGap === "NONE",
  });
}
