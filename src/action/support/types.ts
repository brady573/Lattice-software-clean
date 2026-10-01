/**
 * DP-014 Action support types (first structured support path).
 *
 * Governed Action-class qualification and deterministic ActionSupportRule
 * contracts. Types only; no logic, no persistence, no model call, no F8
 * emission.
 *
 * Binding constraints (from the DP-014 handoff):
 * - The governed class is assigned ONLY from structured Decision state
 *   (outcome, materialUnknowns/frontier shape, exact current intent identity,
 *   qualified origin). Prose is never parsed: candidate, rationale,
 *   explanation, criterion, and model text are never inputs.
 * - The V1 rule may emit PARTIAL|UNKNOWN only. SUFFICIENT is prohibited in
 *   V1; INSUFFICIENT is never emitted by this rule.
 * - `infoStepAvailable: true` follows the established class; the class never
 *   follows the flag.
 */

import type { ActionCandidate, StructuredActionFact } from "../types.js";
import type { StructuredDecision } from "../../domain.js";

/**
 * Governed Action classes with an approved deterministic support rule.
 * V1 carries exactly one member. Future classes require a new approved rule
 * and registry entry; unknown strings never qualify.
 */
export type QualifiedActionClass = "DECISION_EVIDENCE_INVESTIGATION";

/** Approved deterministic support-rule identities. V1 carries exactly one. */
export type ActionSupportRuleId = "DECISION_EVIDENCE_INVESTIGATION_V1";

/**
 * One approved deterministic ActionSupportRule. Rules read governed
 * structured state only and emit zero or more frozen governed facts. V1
 * rules never emit SUFFICIENT or INSUFFICIENT.
 */
export interface ActionSupportRule {
  readonly ruleId: ActionSupportRuleId;
  readonly appliesTo: QualifiedActionClass;
  evaluate(actionClass: unknown): readonly StructuredActionFact[];
}

/**
 * Structured-only class-qualification input. Every member is governed
 * structured state; there is deliberately no prose member to parse.
 */
export interface DecisionEvidenceInvestigationClassInput {
  readonly decision: StructuredDecision | undefined | null;
  readonly requestIntentVersionId: string | undefined | null;
  readonly currentIntentVersionId: string | undefined | null;
  readonly decisionNeed: "NONE" | "UNRESOLVED" | "QUALIFIED" | undefined | null;
  readonly decisionInput: unknown;
}

/** Input to the deterministic Decision-to-Action candidate projection. */
export interface DecisionEvidenceInvestigationProjectionInput {
  readonly decision: StructuredDecision;
  readonly actionClass: QualifiedActionClass | undefined;
}

/**
 * The projected investigation candidate: the governed class token plus a
 * fixed Product-owned description. `factRefs` preserves the structured
 * material-unknown refs and relevant decision evidence identifiers for
 * future routing/inspectability; they are never user-visible raw machinery
 * by default.
 */
export interface DecisionEvidenceInvestigationCandidate extends ActionCandidate {
  readonly actionClass: QualifiedActionClass;
}
