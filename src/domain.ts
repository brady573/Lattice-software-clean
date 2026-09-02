import { z } from "zod";

export const prioritySchema = z.object({
  criterion: z.string().min(1),
  weight: z.number().positive(),
});

export const hardConstraintSchema = z.object({
  criterion: z.string().min(1),
  operator: z.enum(["lte", "gte", "eq"]),
  value: z.union([z.number(), z.string(), z.boolean()]),
});

export const runRequestSchema = z.object({
  goal: z.string().min(3),
  priorities: z.array(prioritySchema).min(1),
  hardConstraints: z.array(hardConstraintSchema).min(1),
});

export type RunRequest = z.infer<typeof runRequestSchema>;
export type Priority = z.infer<typeof prioritySchema>;
export type HardConstraint = z.infer<typeof hardConstraintSchema>;

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
  winnerCandidateId: string;
  evaluations: CandidateEvaluation[];
  rationale: string[];
  evidenceIds: string[];
  truthAssessmentIds: string[];
}

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
  request: RunRequest;
  decision: StructuredDecision | null;
  explanation: string | null;
  truthAssessmentIds: string[];
  events: RunEvent[];
}
