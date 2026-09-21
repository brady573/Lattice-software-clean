import { z } from "zod";
import type {
  FrontierDecisionIds,
  MultipleDecisionIds,
  NonEmptyDecisionIds,
  StructuredDecision,
} from "../domain.js";

const decisionOutcomeSchema = z.enum([
  "RECOMMENDATION",
  "FRONTIER",
  "TIE",
  "INSUFFICIENT_EVIDENCE",
  "UNRESOLVED",
  "NO_ELIGIBLE_CANDIDATE",
]);

const evidenceValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const constraintResultSchema = z.object({
  criterion: z.string(),
  passed: z.boolean().nullable(),
  observed: evidenceValueSchema,
  expected: evidenceValueSchema,
}).strict();

const candidateEvaluationSchema = z.object({
  candidateId: z.string(),
  eligible: z.boolean(),
  rawScore: z.number(),
  normalizedScore: z.number(),
  constraints: z.array(constraintResultSchema),
  supportingEvidenceIds: z.array(z.string()),
}).strict();

const decisionCommonShape = {
  goal: z.string(),
  winnerCandidateId: z.string().optional(),
  evaluations: z.array(candidateEvaluationSchema),
  rationale: z.array(z.string()),
  evidenceIds: z.array(z.string()),
  truthAssessmentIds: z.array(z.string()),
};

const currentStructuredDecisionSchema = z.object({
  ...decisionCommonShape,
  outcome: decisionOutcomeSchema,
  frontierCandidateIds: z.array(z.string()),
  tiedCandidateIds: z.array(z.string()),
  materialUnknowns: z.array(z.string()),
}).strict();

const persistedStructuredDecisionSchema = z.object({
  ...decisionCommonShape,
  outcome: decisionOutcomeSchema.optional(),
  frontierCandidateIds: z.array(z.string()).optional(),
  tiedCandidateIds: z.array(z.string()).optional(),
  materialUnknowns: z.array(z.string()).optional(),
}).strict();

type CurrentStructuredDecisionInput = z.infer<typeof currentStructuredDecisionSchema>;
type PersistedStructuredDecisionInput = z.infer<typeof persistedStructuredDecisionSchema>;
type ValidationSurface = "current" | "persisted";

function invalid(surface: ValidationSurface, message: string): never {
  throw new Error(`Invalid ${surface} StructuredDecision: ${message}`);
}

function nonEmpty(values: readonly string[], field: string, surface: ValidationSurface): NonEmptyDecisionIds {
  if (values.length === 0) invalid(surface, `${field} must be non-empty for this outcome.`);
  return [values[0]!, ...values.slice(1)];
}

function multiple(values: readonly string[], field: string, surface: ValidationSurface): MultipleDecisionIds {
  if (values.length < 2) invalid(surface, `${field} must contain at least two candidates for this outcome.`);
  return [values[0]!, values[1]!, ...values.slice(2)];
}

function distinct(values: readonly string[], field: string, surface: ValidationSurface): void {
  if (new Set(values).size !== values.length) {
    invalid(surface, `${field} cannot contain duplicate candidate identities.`);
  }
}

function frontier(values: readonly string[], surface: ValidationSurface): FrontierDecisionIds {
  distinct(values, "frontierCandidateIds", surface);
  if (values.length === 0) return [];
  return multiple(values, "frontierCandidateIds", surface);
}

function sameCandidateSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((candidateId) => rightSet.has(candidateId));
}

function evaluationIndex(
  input: CurrentStructuredDecisionInput,
  surface: ValidationSurface,
): Map<string, CurrentStructuredDecisionInput["evaluations"][number]> {
  const byCandidateId = new Map<string, CurrentStructuredDecisionInput["evaluations"][number]>();
  for (const evaluation of input.evaluations) {
    if (byCandidateId.has(evaluation.candidateId)) {
      invalid(surface, "CandidateEvaluation.candidateId values must be unique.");
    }
    byCandidateId.set(evaluation.candidateId, evaluation);
  }
  return byCandidateId;
}

function assertActiveCandidates(
  candidateIds: readonly string[],
  evaluations: ReadonlyMap<string, CurrentStructuredDecisionInput["evaluations"][number]>,
  surface: ValidationSurface,
  options: { requireEligible: boolean },
): void {
  for (const candidateId of candidateIds) {
    const evaluation = evaluations.get(candidateId);
    if (!evaluation) invalid(surface, `active candidate ${candidateId} is absent from evaluations.`);
    if (options.requireEligible && !evaluation.eligible) {
      invalid(surface, `active candidate ${candidateId} must have an eligible evaluation for this outcome.`);
    }
  }
}

function common(input: CurrentStructuredDecisionInput) {
  return {
    goal: input.goal,
    evaluations: input.evaluations.map((evaluation) => ({
      ...evaluation,
      constraints: evaluation.constraints.map((constraint) => ({ ...constraint })),
      supportingEvidenceIds: [...evaluation.supportingEvidenceIds],
    })),
    rationale: [...input.rationale],
    evidenceIds: [...input.evidenceIds],
    truthAssessmentIds: [...input.truthAssessmentIds],
  };
}

function canonicalizeCurrentInput(
  input: CurrentStructuredDecisionInput,
  surface: ValidationSurface,
): StructuredDecision {
  const evaluations = evaluationIndex(input, surface);
  const shared = common(input);

  switch (input.outcome) {
    case "RECOMMENDATION": {
      if (input.winnerCandidateId === undefined) invalid(surface, "RECOMMENDATION requires a winner.");
      if (
        input.frontierCandidateIds.length !== 1
        || input.frontierCandidateIds[0] !== input.winnerCandidateId
      ) {
        invalid(surface, "RECOMMENDATION frontier must contain exactly its winner.");
      }
      if (input.tiedCandidateIds.length !== 0 || input.materialUnknowns.length !== 0) {
        invalid(surface, "RECOMMENDATION cannot simultaneously represent tie or unresolved state.");
      }
      assertActiveCandidates([input.winnerCandidateId], evaluations, surface, { requireEligible: true });
      return {
        ...shared,
        outcome: "RECOMMENDATION",
        winnerCandidateId: input.winnerCandidateId,
        frontierCandidateIds: [input.winnerCandidateId],
        tiedCandidateIds: [],
        materialUnknowns: [],
      };
    }
    case "FRONTIER": {
      if (input.winnerCandidateId !== undefined) invalid(surface, "FRONTIER cannot carry a winner.");
      if (input.tiedCandidateIds.length !== 0 || input.materialUnknowns.length !== 0) {
        invalid(surface, "FRONTIER cannot simultaneously represent tie or unresolved state.");
      }
      const frontierCandidateIds = frontier(input.frontierCandidateIds, surface);
      assertActiveCandidates(frontierCandidateIds, evaluations, surface, { requireEligible: true });
      return {
        ...shared,
        outcome: "FRONTIER",
        frontierCandidateIds,
        tiedCandidateIds: [],
        materialUnknowns: [],
      };
    }
    case "TIE": {
      if (input.winnerCandidateId !== undefined) invalid(surface, "TIE cannot carry a winner.");
      if (input.materialUnknowns.length !== 0) invalid(surface, "TIE cannot simultaneously represent unresolved state.");
      distinct(input.frontierCandidateIds, "frontierCandidateIds", surface);
      distinct(input.tiedCandidateIds, "tiedCandidateIds", surface);
      const frontierCandidateIds = multiple(input.frontierCandidateIds, "frontierCandidateIds", surface);
      multiple(input.tiedCandidateIds, "tiedCandidateIds", surface);
      if (!sameCandidateSet(frontierCandidateIds, input.tiedCandidateIds)) {
        invalid(surface, "TIE frontier and tied candidates must describe the same candidate set.");
      }
      assertActiveCandidates(frontierCandidateIds, evaluations, surface, { requireEligible: true });
      return {
        ...shared,
        outcome: "TIE",
        frontierCandidateIds,
        tiedCandidateIds: multiple(frontierCandidateIds, "tiedCandidateIds", surface),
        materialUnknowns: [],
      };
    }
    case "INSUFFICIENT_EVIDENCE": {
      if (input.winnerCandidateId !== undefined) invalid(surface, "INSUFFICIENT_EVIDENCE cannot carry a winner.");
      if (input.tiedCandidateIds.length !== 0) invalid(surface, "INSUFFICIENT_EVIDENCE cannot carry tied candidates.");
      distinct(input.frontierCandidateIds, "frontierCandidateIds", surface);
      const frontierCandidateIds = nonEmpty(input.frontierCandidateIds, "frontierCandidateIds", surface);
      const materialUnknowns = nonEmpty(input.materialUnknowns, "materialUnknowns", surface);
      assertActiveCandidates(frontierCandidateIds, evaluations, surface, { requireEligible: false });
      return {
        ...shared,
        outcome: "INSUFFICIENT_EVIDENCE",
        frontierCandidateIds,
        tiedCandidateIds: [],
        materialUnknowns,
      };
    }
    case "UNRESOLVED": {
      if (input.winnerCandidateId !== undefined) invalid(surface, "UNRESOLVED cannot carry a winner.");
      if (input.tiedCandidateIds.length !== 0) invalid(surface, "UNRESOLVED cannot carry tied candidates.");
      distinct(input.frontierCandidateIds, "frontierCandidateIds", surface);
      const materialUnknowns = nonEmpty(input.materialUnknowns, "materialUnknowns", surface);
      assertActiveCandidates(input.frontierCandidateIds, evaluations, surface, { requireEligible: true });
      return {
        ...shared,
        outcome: "UNRESOLVED",
        frontierCandidateIds: [...input.frontierCandidateIds],
        tiedCandidateIds: [],
        materialUnknowns,
      };
    }
    case "NO_ELIGIBLE_CANDIDATE":
      if (input.winnerCandidateId !== undefined) invalid(surface, "NO_ELIGIBLE_CANDIDATE cannot carry a winner.");
      if (
        input.frontierCandidateIds.length !== 0
        || input.tiedCandidateIds.length !== 0
        || input.materialUnknowns.length !== 0
      ) {
        invalid(surface, "NO_ELIGIBLE_CANDIDATE cannot carry an active frontier, tie, or unresolved state.");
      }
      return {
        ...shared,
        outcome: "NO_ELIGIBLE_CANDIDATE",
        frontierCandidateIds: [],
        tiedCandidateIds: [],
        materialUnknowns: [],
      };
  }
}

/**
 * Validates and deterministically canonicalizes one already-current decision.
 * This boundary never interprets legacy shapes or selects a different winner.
 */
export function validateCurrentStructuredDecision(value: unknown): StructuredDecision {
  const parsed = currentStructuredDecisionSchema.safeParse(value);
  if (!parsed.success) invalid("current", "decision does not match the current StructuredDecision shape.");
  return canonicalizeCurrentInput(parsed.data, "current");
}

/**
 * Converts persisted decision JSON into the one current StructuredDecision
 * union. The only legacy upgrade is the repository-evidenced original
 * winner-only shape that predates explicit outcome/frontier state.
 */
export function parseStructuredDecision(value: unknown): StructuredDecision {
  const parsed = persistedStructuredDecisionSchema.safeParse(value);
  if (!parsed.success) invalid("persisted", "decision JSON does not match the supported persisted shape.");
  const input = parsed.data;

  if (input.outcome === undefined) {
    if (
      input.winnerCandidateId === undefined
      || input.frontierCandidateIds !== undefined
      || input.tiedCandidateIds !== undefined
      || input.materialUnknowns !== undefined
    ) {
      invalid("persisted", "legacy decision state is ambiguous and cannot be upgraded safely.");
    }
    return canonicalizeCurrentInput({
      ...input,
      outcome: "RECOMMENDATION",
      frontierCandidateIds: [input.winnerCandidateId],
      tiedCandidateIds: [],
      materialUnknowns: [],
    }, "persisted");
  }

  if (
    input.frontierCandidateIds === undefined
    || input.tiedCandidateIds === undefined
    || input.materialUnknowns === undefined
  ) {
    invalid("persisted", "current outcome states must carry explicit frontier, tie, and material-unknown arrays.");
  }

  return canonicalizeCurrentInput({
    ...input,
    outcome: input.outcome,
    frontierCandidateIds: input.frontierCandidateIds,
    tiedCandidateIds: input.tiedCandidateIds,
    materialUnknowns: input.materialUnknowns,
  }, "persisted");
}
