/**
 * DP-014 first ruled path: DECISION_EVIDENCE_INVESTIGATION.
 *
 * Covers Decision Engine INSUFFICIENT_EVIDENCE — a StructuredDecision with
 * outcome INSUFFICIENT_EVIDENCE, non-empty materialUnknowns, and non-empty
 * frontierCandidateIds, produced when admitted evidence is insufficient for
 * at least one execution-significant comparison.
 *
 * Binding constraints (from the handoff):
 * - Class assignment reads ONLY structured Decision state plus exact intent
 *   identity plus qualified origin. It never inspects candidate, rationale,
 *   explanation, criterion, or model text.
 * - Intent freshness is exact identity: run/request intentVersionId must
 *   exactly equal the current authoritative IntentVersion.intentVersionId.
 *   Mismatch (or absence) yields no class. No semantic equivalence.
 * - Rule DECISION_EVIDENCE_INVESTIGATION_V1 applies only to that class and
 *   may emit PARTIAL|UNKNOWN only: the single PARTIAL fact with
 *   infoStepAvailable, or nothing (absence preferred over an explicit
 *   UNKNOWN fact). Never SUFFICIENT, never INSUFFICIENT.
 * - No consequence/reversibility/safeguard/authorization/execution/
 *   verification flags are manufactured here.
 *
 * Pure, deterministic, dependency-free beyond sibling types. No model call,
 * no persistence, no F8 emission.
 */

import type { StructuredActionFact } from "../types.js";
import type {
  ActionSupportRule,
  DecisionEvidenceInvestigationCandidate,
  DecisionEvidenceInvestigationClassInput,
  DecisionEvidenceInvestigationProjectionInput,
  QualifiedActionClass,
} from "./types.js";

/**
 * Fixed Product-owned description of the projected investigation move.
 * Constant prose owned by the Product surface: it names the governed next
 * move (resolve the material decision-evidence gaps before choosing) and
 * carries no model-generated wording and no internal machinery vocabulary.
 */
export const DECISION_EVIDENCE_INVESTIGATION_ACTION =
  "Investigate the missing decision evidence before choosing.";

/** Empty frozen result shared by the rule's no-class path. */
const NO_FACTS: readonly StructuredActionFact[] = Object.freeze([]);

/**
 * Deterministic class assignment. Returns the governed class iff ALL hold:
 * C1 decision.outcome === INSUFFICIENT_EVIDENCE;
 * C2 decision.materialUnknowns is non-empty (with non-empty
 *    frontierCandidateIds, per the ruled-path definition);
 * C3 request intentVersionId exactly equals the current authoritative
 *    IntentVersion.intentVersionId;
 * C4 the originating consultation request had decisionNeed === QUALIFIED
 *    with an exact qualified Decision input present.
 * Anything else — stale intent, non-qualified origin, missing decision,
 * any other outcome, malformed state — yields `undefined` (no class, so no
 * rule, so UNKNOWN downstream via absence).
 */
export function qualifyDecisionEvidenceInvestigationClass(
  input: DecisionEvidenceInvestigationClassInput,
): QualifiedActionClass | undefined {
  const decision = input.decision as
    | { outcome?: unknown; materialUnknowns?: unknown; frontierCandidateIds?: unknown }
    | undefined
    | null;
  if (decision === undefined || decision === null || typeof decision !== "object") return undefined;
  if (decision.outcome !== "INSUFFICIENT_EVIDENCE") return undefined;
  if (!Array.isArray(decision.materialUnknowns) || decision.materialUnknowns.length === 0) {
    return undefined;
  }
  if (!Array.isArray(decision.frontierCandidateIds) || decision.frontierCandidateIds.length === 0) {
    return undefined;
  }
  const requested = input.requestIntentVersionId;
  const current = input.currentIntentVersionId;
  if (typeof requested !== "string" || requested.length === 0) return undefined;
  if (typeof current !== "string" || current.length === 0) return undefined;
  if (requested !== current) return undefined;
  if (input.decisionNeed !== "QUALIFIED") return undefined;
  if (input.decisionInput === undefined || input.decisionInput === null) return undefined;
  if (typeof input.decisionInput !== "object") return undefined;
  return "DECISION_EVIDENCE_INVESTIGATION";
}

/**
 * Deterministic Decision-to-Action adapter. Projects an established governed
 * class plus its StructuredDecision into the investigation ActionCandidate.
 * The candidate carries the fixed Product-owned description and structured
 * factRefs (materialUnknowns + decision evidence identifiers); no
 * model-generated prose defines it. Returns `undefined` unless the class is
 * established and the decision carries the ruled INSUFFICIENT_EVIDENCE
 * shape — never a generic Solandra actionCandidate.
 */
export function projectDecisionEvidenceInvestigation(
  input: DecisionEvidenceInvestigationProjectionInput,
): DecisionEvidenceInvestigationCandidate | undefined {
  if (input.actionClass !== "DECISION_EVIDENCE_INVESTIGATION") return undefined;
  const decision = input.decision;
  if (decision.outcome !== "INSUFFICIENT_EVIDENCE") return undefined;
  if (decision.frontierCandidateIds.length === 0 || decision.materialUnknowns.length === 0) {
    return undefined;
  }
  return Object.freeze({
    actionClass: "DECISION_EVIDENCE_INVESTIGATION" as const,
    action: DECISION_EVIDENCE_INVESTIGATION_ACTION,
    facts: NO_FACTS,
    factRefs: Object.freeze([...decision.materialUnknowns, ...decision.evidenceIds]),
  });
}

/** The single governed support fact V1 may emit. */
const INVESTIGATION_SUPPORT_FACT: StructuredActionFact = Object.freeze({
  source: "ACTION_SUPPORT_RULE" as const,
  support: "PARTIAL" as const,
  infoStepAvailable: true as const,
});

/**
 * Rule DECISION_EVIDENCE_INVESTIGATION_V1. Applies only to the governed
 * DECISION_EVIDENCE_INVESTIGATION class and emits the single PARTIAL fact
 * (positive support for gap investigation, with the investigation step
 * available because the class exists only with non-empty materialUnknowns).
 * Any other class — including registry misses routed here — yields no facts.
 * Absence is preferred over an explicit UNKNOWN fact.
 */
export const DECISION_EVIDENCE_INVESTIGATION_V1: ActionSupportRule = Object.freeze({
  ruleId: "DECISION_EVIDENCE_INVESTIGATION_V1" as const,
  appliesTo: "DECISION_EVIDENCE_INVESTIGATION" as const,
  evaluate(actionClass: unknown): readonly StructuredActionFact[] {
    if (actionClass !== "DECISION_EVIDENCE_INVESTIGATION") return NO_FACTS;
    return Object.freeze([INVESTIGATION_SUPPORT_FACT]);
  },
});
