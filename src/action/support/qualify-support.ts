/**
 * DP-014 support-fact qualification (first structured support path).
 *
 * Runs the approved rule for an established governed class and returns
 * zero or more frozen governed facts for the shared F4 `evaluate()`
 * pipeline. A registry miss (unknown class, stale intent, non-qualified
 * origin, any non-ruled Decision outcome) emits nothing — UNKNOWN by
 * absence, never an explicit UNKNOWN fact.
 *
 * Orchestration note (§15): the Decision path must NOT be forced through
 * the DP-013 generic adapter. Decision result → Decision Action adapter
 * (`projectDecisionEvidenceInvestigation`) → ActionCandidate + these rule
 * facts → shared F4 `evaluate()`. The generic DP-013 path is unchanged:
 * a generic candidate carries no governed class, so this module emits
 * nothing for it.
 *
 * Pure, deterministic, dependency-free beyond siblings. No model call, no
 * persistence, no F8 emission.
 */

import type { StructuredActionFact } from "../types.js";
import { ruleForClass } from "./registry.js";
import type { QualifiedActionClass } from "./types.js";

/**
 * Run the approved rule for `actionClass` and return its governed facts
 * (V1: exactly one PARTIAL fact, or none). `undefined` or any unregistered
 * class yields the empty frozen set.
 */
export function qualifySupportFacts(
  actionClass: QualifiedActionClass | undefined,
): readonly StructuredActionFact[] {
  const rule = ruleForClass(actionClass);
  if (rule === undefined) return Object.freeze([]);
  return rule.evaluate(actionClass);
}
