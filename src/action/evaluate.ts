/**
 * F4 end-to-end composition (DP-010/DP-012/DP-015).
 *
 * `evaluate` composes the frozen Task 2–3 contracts with DP-015 effect
 * qualification and no new selection rules beyond the SUFFICIENT
 * unknown-effect veto owned by `selectMode`:
 * effect facts for the candidate's governed class (empty in v1) +
 * `qualifyAction({candidate, qualifiedFacts})` → derive the three selection
 * step flags from non-effect allowlisted governed-fact flags →
 * `selectMode(...)` → assemble the frozen 8-field `ActionDecision` with the
 * action echoed verbatim and user-facing strings from fixed categorical
 * templates. Deterministic; no model call; no numbers; no prose parsing.
 */

import { qualifyAction } from "./qualify.js";
import { qualifyActionEffects } from "./effects/qualify-effects.js";
import { selectMode } from "./select.js";
import type {
  ActionDecision,
  ActionEngineInput,
  ActionMode,
  ConsequenceLevel,
  StructuredActionFact,
} from "./types.js";

/** The fixed 8-member source allowlist (Tasks 1–2 contract plus DP-014 ACTION_SUPPORT_RULE plus DP-015 ACTION_EFFECT_RULE, reused verbatim). */
const PERMITTED_SOURCES: ReadonlySet<string> = new Set<string>([
  "CANDIDATE_PROPOSAL",
  "F6_CALIBRATED_SIGNAL",
  "INTENT_AUTHORITY",
  "KNOWLEDGE_V36",
  "DECISION_ENGINE_RESULT",
  "CAPABILITY_EFFECT",
  "ACTION_SUPPORT_RULE",
  "ACTION_EFFECT_RULE",
]);

/**
 * Step-flag derivation honors the same allowlist as qualification, and
 * DP-015 effect-source authority: a runtime-smuggled source can never flip
 * WAIT → INVESTIGATE/TEST or force ESCALATE through a step flag, and an
 * ACTION_EFFECT_RULE fact (which may carry only consequence/reversibility)
 * can never set a step flag.
 */
function isPermittedFact(fact: StructuredActionFact): boolean {
  if (fact === null || typeof fact !== "object") return false;
  const source: unknown = (fact as { source?: unknown }).source;
  return typeof source === "string" && PERMITTED_SOURCES.has(source);
}

function isPermittedStepFact(fact: StructuredActionFact): boolean {
  return isPermittedFact(fact) && fact.source !== "ACTION_EFFECT_RULE";
}

function expectedOutcomeFor(mode: ActionMode): string {
  switch (mode) {
    case "ACT":
      return "The proposed step is ready to take as stated.";
    case "WAIT":
      return "Hold off for now; the missing pieces must come first.";
    case "INVESTIGATE":
      return "Find the missing information first, then decide.";
    case "TEST":
      return "Try the bounded check first, then decide.";
    case "ESCALATE":
      return "Ask an outside expert to weigh in before deciding.";
  }
}

function riskFor(consequence: ConsequenceLevel): string {
  switch (consequence) {
    case "LOW":
      return "The downside looks limited if the step is taken as stated.";
    case "MATERIAL":
      return "The downside could be notable if the step proves wrong.";
    case "HIGH":
      return "The downside could be serious if the step proves wrong.";
    case "UNKNOWN":
      return "The downside is not yet established.";
  }
}

function verificationFor(mode: ActionMode): string {
  switch (mode) {
    case "ACT":
      return "Check the result after taking the step.";
    case "WAIT":
      return "Revisit once the missing pieces arrive.";
    case "INVESTIGATE":
      return "Record what the follow-up answers show.";
    case "TEST":
      return "Record what the check shows before deciding further.";
    case "ESCALATE":
      return "Record what the expert review concludes.";
  }
}

/**
 * Qualify → select → assemble. Effect facts for the candidate's governed
 * class are derived first (empty under the v1 empty registry) and combined
 * with existing facts for qualification/selection. The action is echoed
 * verbatim from `candidate.action`; `reversibility`/`blockingUnknowns`
 * come from qualification; `reason` comes from selection; the remaining
 * user-facing strings come from fixed categorical templates.
 */
export function evaluate(input: ActionEngineInput): ActionDecision {
  const effectFacts = qualifyActionEffects({
    actionClass: input.candidate.actionClass,
    facts: [...input.candidate.facts, ...input.qualifiedFacts],
  });
  const qualifiedFacts = [...input.qualifiedFacts, ...effectFacts];
  const qualification = qualifyAction({
    candidate: input.candidate,
    qualifiedFacts,
  });
  const governedFacts = qualifiedFacts.filter(isPermittedFact);
  const stepFacts = governedFacts.filter(isPermittedStepFact);
  const selection = selectMode({
    qualification,
    calibration: input.calibration,
    infoStepAvailable: stepFacts.some((fact) => fact.infoStepAvailable === true),
    diagnosticStepAvailable: stepFacts.some((fact) => fact.diagnosticStepAvailable === true),
    oversightRequired: stepFacts.some((fact) => fact.oversightRequired === true),
  });
  return Object.freeze({
    mode: selection.mode,
    action: input.candidate.action,
    reason: selection.reason,
    expectedOutcome: expectedOutcomeFor(selection.mode),
    risk: riskFor(qualification.consequence),
    reversibility: qualification.reversibility,
    verification: verificationFor(selection.mode),
    blockingUnknowns: qualification.blockingUnknowns,
  });
}
