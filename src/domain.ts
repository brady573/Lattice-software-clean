import { z } from "zod";
import { decisionInputSnapshotSchema } from "./decision/decision-input-snapshot.js";

export const prioritySchema = z.object({
  criterion: z.string().min(1),
  weight: z.number().positive(),
});

export const hardConstraintSchema = z.object({
  criterion: z.string().min(1),
  operator: z.enum(["lte", "gte", "eq"]),
  value: z.union([z.number(), z.string(), z.boolean()]),
});

/**
 * Legacy qualified-decision request retained for compatibility with existing
 * decision endpoints. It is no longer the universal Product intake shape.
 */
export const runRequestSchema = z.object({
  goal: z.string().min(3),
  priorities: z.array(prioritySchema).min(1),
  hardConstraints: z.array(hardConstraintSchema).min(1),
});

export const consultationRunRequestSchema = z.object({
  kind: z.literal("consultation"),
  objective: z.string().min(1).max(8_000),
  context: z.array(z.string().min(1).max(4_000)).max(32).default([]),
  decisionNeed: z.enum(["NONE", "UNRESOLVED", "QUALIFIED"]).default("NONE"),
  resourceNeed: z.enum(["NONE", "CHECKLIST", "PREPARED_MESSAGE"]).default("NONE"),
  sourceMessageId: z.string().min(1).max(200),
  sourceMessageDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  intentVersion: z.number().int().positive(),
  intentScopeId: z.string().min(1).max(200).optional(),
  intentVersionId: z.string().min(1).max(200).optional(),
  decisionInput: decisionInputSnapshotSchema.optional(),
}).superRefine((request, context) => {
  if (request.decisionNeed === "QUALIFIED" && request.decisionInput === undefined) {
    context.addIssue({
      code: "custom",
      path: ["decisionInput"],
      message: "A qualified consultation requires one exact DecisionInput projection.",
    });
  }
  if (request.decisionNeed !== "QUALIFIED" && request.decisionInput !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["decisionInput"],
      message: "Non-decision consultations must not carry decision planning material.",
    });
  }
});

export type RunRequest = z.infer<typeof runRequestSchema>;
type ConsultationRequestData = z.infer<typeof consultationRunRequestSchema>;
export type ConsultationRunRequest = Omit<ConsultationRequestData, "decisionNeed" | "resourceNeed" | "context"> & {
  context: string[];
  decisionNeed: "NONE" | "UNRESOLVED" | "QUALIFIED";
  resourceNeed: "NONE" | "CHECKLIST" | "PREPARED_MESSAGE";
  /** Compatibility-only absent fields; consultations never require them. */
  goal?: never;
  priorities?: never;
  hardConstraints?: never;
};
export type LatticeRunRequest = RunRequest | ConsultationRunRequest;
export type Priority = z.infer<typeof prioritySchema>;
export type HardConstraint = z.infer<typeof hardConstraintSchema>;

export function isConsultationRunRequest(request: LatticeRunRequest): request is ConsultationRunRequest {
  return "kind" in request && request.kind === "consultation";
}

export function runObjective(request: LatticeRunRequest): string {
  return isConsultationRunRequest(request) ? request.objective : request.goal;
}

export type EvidenceValue = string | number | boolean | null;

export interface Evidence {
  id: string;
  candidateId: string;
  criterion: string;
  value: EvidenceValue;
  sourceId: string;
  sourceLabel: string;
  admitted: boolean;
  rejectionReason?: string;
}

export interface Candidate {
  id: string;
  label: string;
}

export interface ConstraintResult {
  criterion: string;
  passed: boolean | null;
  observed: EvidenceValue;
  expected: EvidenceValue;
}

export interface CandidateEvaluation {
  candidateId: string;
  eligible: boolean;
  rawScore: number;
  normalizedScore: number;
  constraints: ConstraintResult[];
  supportingEvidenceIds: string[];
}

export interface StructuredDecision {
  goal: string;
  /**
   * A decision may deliberately preserve a frontier or non-selection outcome.
   * `winnerCandidateId` remains optional for compatibility with older decisions.
   */
  outcome?: DecisionOutcome;
  winnerCandidateId?: string;
  frontierCandidateIds?: string[];
  tiedCandidateIds?: string[];
  materialUnknowns?: string[];
  evaluations: CandidateEvaluation[];
  rationale: string[];
  evidenceIds: string[];
  truthAssessmentIds: string[];
}

export type DecisionOutcome =
  | "RECOMMENDATION"
  | "FRONTIER"
  | "TIE"
  | "INSUFFICIENT_EVIDENCE"
  | "UNRESOLVED"
  | "NO_ELIGIBLE_CANDIDATE";

export type RunStatus =
  | "CREATED"
  | "UNDERSTANDING"
  | "AWAITING_CLARIFICATION"
  | "PLANNING"
  | "INVESTIGATING"
  | "VALIDATING"
  | "DECIDING"
  | "COMPLETED"
  | "CANCELLED"
  | "FAILED";

export type RunEventType = RunStatus | "EXPLAINING";

export interface RunEvent {
  sequence: number;
  type: RunEventType;
}

export interface LatticeRun {
  id: string;
  conversationId: string;
  status: RunStatus;
  version: number;
  request: LatticeRunRequest;
  decision: StructuredDecision | null;
  explanation: string | null;
  truthAssessmentIds: string[];
  events: RunEvent[];
}
