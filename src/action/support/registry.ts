/**
 * DP-014 Action support registry (first structured support path).
 *
 * Governed class → approved rule mapping. Exact-token lookup only; the
 * registry never matches prose, capability labels, or Solandra purpose
 * labels. A miss yields `undefined` and the caller emits nothing.
 *
 * Pure, deterministic, dependency-free beyond the rule module. No model
 * call, no persistence, no F8 emission.
 */

import {
  DECISION_EVIDENCE_INVESTIGATION_V1,
} from "./decision-evidence-investigation.js";
import type { ActionSupportRule } from "./types.js";

/** The fixed V1 governed-class → approved-rule table. */
const RULES: Readonly<Record<string, ActionSupportRule>> = Object.freeze({
  DECISION_EVIDENCE_INVESTIGATION: DECISION_EVIDENCE_INVESTIGATION_V1,
});

/**
 * Return the approved rule for an established governed class, or
 * `undefined` on any miss. Comparison is exact token identity; no semantic
 * equivalence, no prose matching.
 */
export function ruleForClass(actionClass: unknown): ActionSupportRule | undefined {
  if (typeof actionClass !== "string") return undefined;
  return RULES[actionClass];
}
