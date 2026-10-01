/**
 * DP-013 candidate-to-F4 projection adapter.
 *
 * §7 mapping: action ← proposal.action (required, non-authoritative);
 * expectedOutcome/verification ← validated proposal material, never evidence
 * (F4's evaluate() renders those strings from fixed templates; nothing is
 * persisted); Goal ← exact current IntentVersion, Basis ← validated
 * recommendation basis, Assumptions ← post-F6 screening — all bound at the
 * Task 4 orchestration call sites, not here; consequence/reversibility/
 * support ← UNKNOWN by construction, because this adapter emits no dimension
 * facts and qualifyAction yields UNKNOWN absent structured governed facts.
 *
 * This module maps but never classifies: no model, no store, no F4
 * internals, no consequence/reversibility/support policy, no lexical
 * policing of prose beyond the whitespace drop rule.
 */

import type { ActionCandidate } from "../action/types.js";
import type { ActionCandidateProposal } from "./advisory.js";

/**
 * Project an admitted candidate proposal to an F4 ActionCandidate carrying
 * the action string only. `undefined` in → `undefined` out; whitespace-only
 * `action` → `undefined`; otherwise a frozen `{ action, facts: [], factRefs: [] }`.
 */
export function projectCandidateToAction(
  proposal: ActionCandidateProposal | undefined,
): ActionCandidate | undefined {
  if (proposal === undefined) return undefined;
  if (proposal.action.trim().length === 0) return undefined;
  const candidate: ActionCandidate = {
    action: proposal.action,
    facts: [],
    factRefs: [],
  };
  return Object.freeze(candidate);
}
