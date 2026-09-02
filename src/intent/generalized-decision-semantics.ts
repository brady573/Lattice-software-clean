import { z } from "zod";
import { priorityTierSchema } from "../decision/priority-and-requirements.js";
import { intentProvenanceSchema } from "./types.js";

const criterionIdSchema = z.string().trim().min(1).max(200);
const decisionScalarSchema = z.union([z.number().finite(), z.string(), z.boolean()]);

export const generalizedHardRequirementValueSchema = z.object({
  operator: z.enum(["LTE", "GTE", "EQ"]),
  expected: decisionScalarSchema,
}).strict();

export const generalizedPriorityValueSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("VALUE"), tier: priorityTierSchema }).strict(),
  z.object({ state: z.literal("NO_PREFERENCE") }).strict(),
  z.object({ state: z.literal("OPEN") }).strict(),
  z.object({ state: z.literal("DELEGATED") }).strict(),
]);

export const generalizedToleranceValueSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("VALUE"),
    kind: z.literal("ABSOLUTE"),
    maximumDifference: z.number().finite().nonnegative(),
  }).strict(),
  z.object({ state: z.literal("NO_PREFERENCE") }).strict(),
  z.object({ state: z.literal("OPEN") }).strict(),
  z.object({ state: z.literal("DELEGATED") }).strict(),
]);

const generalizedHardRequirementFieldSchema = z.object({
  value: generalizedHardRequirementValueSchema,
  provenance: intentProvenanceSchema,
}).strict();

const generalizedPriorityFieldSchema = z.object({
  value: generalizedPriorityValueSchema,
  provenance: intentProvenanceSchema,
}).strict();

const generalizedToleranceFieldSchema = z.object({
  value: generalizedToleranceValueSchema,
  provenance: intentProvenanceSchema,
}).strict();

/**
 * Confirmed generalized USER decision semantics owned by Intent Authority.
 *
 * Criterion ids are Product-internal semantic identifiers, not a user-authored UI
 * contract. Criterion versions are deliberately absent: exact qualified versions are
 * resolved later by the Criterion Catalog when a DecisionInput snapshot is built.
 * Material unresolved interpretation remains pending outside this confirmed state.
 */
export const generalizedDecisionIntentStateSchema = z.object({
  hardRequirements: z.record(criterionIdSchema, generalizedHardRequirementFieldSchema),
  priorities: z.record(criterionIdSchema, generalizedPriorityFieldSchema),
  tolerances: z.record(criterionIdSchema, generalizedToleranceFieldSchema),
}).strict();

export const generalizedDecisionIntentVersionSchema = z.object({
  intentScopeId: z.string().trim().min(1).max(200),
  intentVersionId: z.string().trim().min(1).max(200),
  objective: z.object({
    value: z.string().trim().min(1).max(2_000),
    provenance: intentProvenanceSchema,
  }).strict(),
  decisionSemantics: generalizedDecisionIntentStateSchema,
}).strict();

export type GeneralizedHardRequirementValue = z.infer<typeof generalizedHardRequirementValueSchema>;
export type GeneralizedPriorityValue = z.infer<typeof generalizedPriorityValueSchema>;
export type GeneralizedToleranceValue = z.infer<typeof generalizedToleranceValueSchema>;
export type GeneralizedDecisionIntentState = z.infer<typeof generalizedDecisionIntentStateSchema>;
export type GeneralizedDecisionIntentVersion = z.infer<typeof generalizedDecisionIntentVersionSchema>;

export function emptyGeneralizedDecisionIntentState(): GeneralizedDecisionIntentState {
  return { hardRequirements: {}, priorities: {}, tolerances: {} };
}
