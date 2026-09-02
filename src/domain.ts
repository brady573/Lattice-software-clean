import { z } from "zod";
import { intentStateSchema, type IntentState } from "./intent/types.js";

export const prioritySchema = z.object({
  criterion: z.string().min(1),
  weight: z.number().positive(),
}).strict();

export const hardConstraintSchema = z.object({
  criterion: z.string().min(1),
  op: z.enum(["lte", "gte", "eq"]),
  value: z.union([z.number(), z.string()]),
}).strict();

/** Historical bounded decision request retained for compatibility-only composition. */
export const runRequestSchema = z.object({
  goal: z.string().min(1),
  priorities: z.array(prioritySchema).min(1),
  hardConstraints: z.array(hardConstraintSchema),
}).strict();

export const consultationRunRequestSchema = z.object({
  kind: z.literal("consultation"),
  objective: z.string().trim().min(1).max(2_000),
  context: z.array(z.string().trim().min(1).max(2_000)).default([]),
  decisionNeed: z.enum(["NONE", "UNRESOLVED", "QUALIFIED"]),
  resourceNeed: z.enum(["NONE", "CHECKLIST", "PREPARED_MESSAGE"]),
  sourceMessageId: z.string().trim().min(1),
  sourceMessageDigest: z.string().trim().min(1),
  intentScopeId: z.string().trim().min(1),
  intentVersionId: z.string().trim().min(1),
  intentVersionNumber: z.number().int().positive(),
  intentState: intentStateSchema,
  assumptions: z.array(z.string().trim().min(1).max(1_000)).default([]),
}).strict();

export type Priority = z.infer<typeof prioritySchema>;
export type HardConstraint = z.infer<typeof hardConstraintSchema>;
export type RunRequest = z.infer<typeof runRequestSchema>;
export type ConsultationRunRequest = Omit<z.infer<typeof consultationRunRequestSchema>, "intentState"> & {
  intentState: IntentState;
};
export type LatticeRunRequest = RunRequest | ConsultationRunRequest;

export function isConsultationRunRequest(request: LatticeRunRequest): request is ConsultationRunRequest {
  return "kind" in request && request.kind === "consultation";
}

export const runStatusSchema = z.enum([
  "CREATED",
  "UNDERSTANDING",
  "AWAITING_CLARIFICATION",
  "PLANNING",
  "INVESTIGATING",
  "VALIDATING",
  "DECIDING",
  "COMPLETED",
  "CANCELLED",
  "FAILED",
]);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const evidenceSchema = z.object({
  id: z.string(),
  candidateId: z.string(),
  criterion: z.string(),
  value: z.union([z.number(), z.string(), z.boolean()]),
  sourceId: z.string(),
  sourceLabel: z.string(),
  admitted: z.boolean(),
  rejectionReason: z.string().optional(),
}).strict();
export type Evidence = z.infer<typeof evidenceSchema>;

export const candidateSchema = z.object({
  id: z.string(),
  label: z.string(),
}).strict();
export type Candidate = z.infer<typeof candidateSchema>;

export type CriterionEvaluation = {
  criterion: string;
  rawValue: number | string | boolean | null;
  normalized: number | null;
  evidenceId: string | null;
};

/** Historical bounded winner projection. */
export type StructuredDecision = {
  winnerCandidateId: string;
  eligibleCandidateIds: string[];
  excludedCandidates: { candidateId: string; reason: string }[];
  evaluations: Record<string, CriterionEvaluation[]>;
  rationale: string[];
  evidenceIds: string[];
  truthAssessmentIds: string[];
};

export type GeneralizedDecisionResolution =
  | "RECOMMENDATION"
  | "FRONTIER"
  | "TIE"
  | "INSUFFICIENT_EVIDENCE"
  | "UNRESOLVED_CRITERION_SEMANTICS"
  | "NO_ELIGIBLE_RESULT";

export type GeneralizedDecisionState = {
  kind: "GENERALIZED_DECISION";
  intentScopeId: string;
  intentVersionId: string;
  criterionCatalogVersion: number | null;
  objective: string;
  resolution: GeneralizedDecisionResolution;
  alternatives: { alternativeId: string; label: string; eligibility: "ELIGIBLE" | "INELIGIBLE" | "UNKNOWN" }[];
  frontierAlternativeIds: string[];
  recommendedAlternativeId: string | null;
  excludedAlternatives: { alternativeId: string; reason: "INELIGIBLE" | "ELIGIBILITY_UNKNOWN" }[];
  pairwiseDecisions: {
    leftAlternativeId: string;
    rightAlternativeId: string;
    dominantAlternativeId: string | null;
    decisiveTier: "MUST_HAVE" | "MATTERS_MOST" | "IMPORTANT" | "NICE_TO_HAVE" | null;
    reason: "LEFT_DOMINATES" | "RIGHT_DOMINATES" | "SAME_TIER_TRADE_OFF" | "UNRESOLVED_HIGHER_TIER" | "NO_MATERIAL_DIFFERENCE" | "COMPARISON_MISSING";
    materialAdvantages: readonly string[];
    materialTradeOffs: readonly string[];
    unresolvedCriteria: readonly string[];
  }[];
  unresolvedCriteria: string[];
  evidenceIds: string[];
  truthAssessmentIds: string[];
  forcedWinner: false;
};

export type RunDecision = StructuredDecision | GeneralizedDecisionState;

export type RunEvent = {
  sequence: number;
  type: RunStatus | "EXPLAINING";
};

export type LatticeRun = {
  id: string;
  conversationId: string;
  request: LatticeRunRequest;
  status: RunStatus;
  version: number;
  decision: RunDecision | null;
  explanation: string | null;
  events: RunEvent[];
  truthAssessmentIds: string[];
};
