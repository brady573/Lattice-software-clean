import { z } from "zod";
import type {
  MultipleDecisionIds,
  NonEmptyDecisionIds,
  StructuredDecision,
} from "../domain.js";

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

const persistedStructuredDecisionSchema = z.object({
  goal: z.string(),
  outcome: z.enum([
    "RECOMMENDATION",
    "FRONTIER",
    "TIE",
    "INSUFFICIENT_EVIDENCE",
    "UNRESOLVED",
    "NO_ELIGIBLE_CANDIDATE",
  ]).optional(),
  winnerCandidateId: z.string().optional(),
  frontierCandidateIds: z.array(z.string()).optional(),
  tiedCandidateIds: z.array(z.string()).optional(),
  materialUnknowns: z.array(z.string()).optional(),
  evaluations: z.array(candidateEvaluationSchema),
  rationale: z.array(z.string()),
  evidenceIds: z.array(z.string()),
  truthAssessmentIds: z.array(z.string()),
}).strict();

type PersistedStructuredDecisionInput = z.infer<typeof persistedStructuredDecisionSchema>;

function invalid(message: string): never {
  throw new Error(`Invalid persisted StructuredDecision: ${message}`);
}

function nonEmpty(values: string[], field: string): NonEmptyDecisionIds {
  if (values.length === 0) invalid(`${field} must be non-empty for this outcome.`);
  return [values[0]!, ...values.slice(1)];
}

function multiple(values: string[], field: string): MultipleDecisionIds {
  if (values.length < 2) invalid(`${field} must contain at least two candidates for this outcome.`);
  return [values[0]!, values[1]!, ...values.slice(2)];
}

function sameSequence(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function currentArrays(input: PersistedStructuredDecisionInput): {
  frontierCandidateIds: string[];
  tiedCandidateIds: string[];
  materialUnknowns: string[];
} {
  if (
    input.frontierCandidateIds === undefined
    || input.tiedCandidateIds === undefined
    || input.materialUnknowns === undefined
  ) {
    invalid("current outcome states must carry explicit frontier, tie, and material-unknown arrays.");
  }
  return {
    frontierCandidateIds: [...input.frontierCandidateIds],
    tiedCandidateIds: [...input.tiedCandidateIds],
    materialUnknowns: [...input.materialUnknowns],
  };
}

function common(input: PersistedStructuredDecisionInput) {
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

/**
 * Converts persisted decision JSON into the one current StructuredDecision
 * union. The only legacy upgrade is the repository-evidenced original
 * winner-only shape that predates explicit outcome/frontier state.
 */
export function parseStructuredDecision(value: unknown): StructuredDecision {
  const parsed = persistedStructuredDecisionSchema.safeParse(value);
  if (!parsed.success) invalid("decision JSON does not match the supported persisted shape.");
  const input = parsed.data;
  const shared = common(input);

  if (input.outcome === undefined) {
    if (
      input.winnerCandidateId === undefined
      || input.frontierCandidateIds !== undefined
      || input.tiedCandidateIds !== undefined
      || input.materialUnknowns !== undefined
    ) {
      invalid("legacy decision state is ambiguous and cannot be upgraded safely.");
    }
    return {
      ...shared,
      outcome: "RECOMMENDATION",
      winnerCandidateId: input.winnerCandidateId,
      frontierCandidateIds: [input.winnerCandidateId],
      tiedCandidateIds: [],
      materialUnknowns: [],
    };
  }

  const arrays = currentArrays(input);
  switch (input.outcome) {
    case "RECOMMENDATION": {
      if (input.winnerCandidateId === undefined) invalid("RECOMMENDATION requires a winner.");
      if (
        arrays.frontierCandidateIds.length !== 1
        || arrays.frontierCandidateIds[0] !== input.winnerCandidateId
      ) invalid("RECOMMENDATION frontier must contain exactly its winner.");
      if (arrays.tiedCandidateIds.length !== 0 || arrays.materialUnknowns.length !== 0) {
        invalid("RECOMMENDATION cannot simultaneously represent tie or unresolved state.");
      }
      return {
        ...shared,
        outcome: "RECOMMENDATION",
        winnerCandidateId: input.winnerCandidateId,
        frontierCandidateIds: [input.winnerCandidateId],
        tiedCandidateIds: [],
        materialUnknowns: [],
      };
    }
    case "FRONTIER":
      if (input.winnerCandidateId !== undefined) invalid("FRONTIER cannot carry a winner.");
      if (arrays.tiedCandidateIds.length !== 0 || arrays.materialUnknowns.length !== 0) {
        invalid("FRONTIER cannot simultaneously represent tie or unresolved state.");
      }
      return {
        ...shared,
        outcome: "FRONTIER",
        frontierCandidateIds: arrays.frontierCandidateIds,
        tiedCandidateIds: [],
        materialUnknowns: [],
      };
    case "TIE": {
      if (input.winnerCandidateId !== undefined) invalid("TIE cannot carry a winner.");
      const frontierCandidateIds = multiple(arrays.frontierCandidateIds, "frontierCandidateIds");
      const tiedCandidateIds = multiple(arrays.tiedCandidateIds, "tiedCandidateIds");
      if (!sameSequence(frontierCandidateIds, tiedCandidateIds)) {
        invalid("TIE frontier and tied candidates must describe the same ordered candidates.");
      }
      if (arrays.materialUnknowns.length !== 0) invalid("TIE cannot simultaneously represent unresolved state.");
      return {
        ...shared,
        outcome: "TIE",
        frontierCandidateIds,
        tiedCandidateIds,
        materialUnknowns: [],
      };
    }
    case "INSUFFICIENT_EVIDENCE":
      if (input.winnerCandidateId !== undefined) invalid("INSUFFICIENT_EVIDENCE cannot carry a winner.");
      if (arrays.tiedCandidateIds.length !== 0) invalid("INSUFFICIENT_EVIDENCE cannot carry tied candidates.");
      return {
        ...shared,
        outcome: "INSUFFICIENT_EVIDENCE",
        frontierCandidateIds: arrays.frontierCandidateIds,
        tiedCandidateIds: [],
        materialUnknowns: nonEmpty(arrays.materialUnknowns, "materialUnknowns"),
      };
    case "UNRESOLVED":
      if (input.winnerCandidateId !== undefined) invalid("UNRESOLVED cannot carry a winner.");
      if (arrays.tiedCandidateIds.length !== 0) invalid("UNRESOLVED cannot carry tied candidates.");
      return {
        ...shared,
        outcome: "UNRESOLVED",
        frontierCandidateIds: arrays.frontierCandidateIds,
        tiedCandidateIds: [],
        materialUnknowns: nonEmpty(arrays.materialUnknowns, "materialUnknowns"),
      };
    case "NO_ELIGIBLE_CANDIDATE":
      if (input.winnerCandidateId !== undefined) invalid("NO_ELIGIBLE_CANDIDATE cannot carry a winner.");
      if (
        arrays.frontierCandidateIds.length !== 0
        || arrays.tiedCandidateIds.length !== 0
        || arrays.materialUnknowns.length !== 0
      ) invalid("NO_ELIGIBLE_CANDIDATE cannot carry an active frontier, tie, or unresolved state.");
      return {
        ...shared,
        outcome: "NO_ELIGIBLE_CANDIDATE",
        frontierCandidateIds: [],
        tiedCandidateIds: [],
        materialUnknowns: [],
      };
  }
}

