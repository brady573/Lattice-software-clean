/**
 * F4 end-to-end composition (DP-010/DP-012).
 *
 * `evaluate` composes the frozen Task 2–3 contracts with no new rules:
 * `qualifyAction({candidate, qualifiedFacts})` → derive the three selection
 * step flags from allowlisted governed-fact flags → `selectMode(...)` →
 * assemble the frozen 8-field `ActionDecision` with the action echoed
 * verbatim and user-facing strings from fixed categorical templates.
 * Deterministic; no model call; no numbers; no prose parsing.
 */

import { qualifyAction } from "./qualify.js";
import { selectMode } from "./select.js";
import type {
  ActionDecision,
  ActionEngineInput,
  ActionMode,
  ConsequenceLevel,
  StructuredActionFact,
} from "./types.js";

/** The fixed 6-member source allowlist (Tasks 1–2 contract, reused verbatim). */
const PERMITTED_SOURCES: ReadonlySet<string> = new Set<string>([
  "CANDIDATE_PROPOSAL",
  "F6_CALIBRATED_SIGNAL",
  "INTENT_AUTHORITY",
  "KNOWLEDGE_V36",
  "DECISION_ENGINE_RESULT",
  "CAPABILITY_EFFECT",
]);

/**
 * Step-flag derivation honors the same allowlist as qualification: a
 * runtime-smuggled source can never flip WAIT → INVESTIGATE/TEST or force
 * ESCALATE through a step flag.
 */
function isPermittedFact(fact: StructuredActionFact): boolean {
  if (fact === null || typeof fact !== "object") return false;
  const source: unknown = (fact as { source?: unknown }).source;
  return typeof source === "string" && PERMITTED_SOURCES.has(source);
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
 * Qualify → select → assemble. The action is echoed verbatim from
 * `candidate.action`; `reversibility`/`blockingUnknowns` come from
 * qualification; `reason` comes from selection; the remaining user-facing
 * strings come from fixed categorical templates.
 */
export function evaluate(input: ActionEngineInput): ActionDecision {
  const qualification = qualifyAction({
    candidate: input.candidate,
    qualifiedFacts: input.qualifiedFacts,
  });
  const governedFacts = input.qualifiedFacts.filter(isPermittedFact);
  const selection = selectMode({
    qualification,
    calibration: input.calibration,
    infoStepAvailable: governedFacts.some((fact) => fact.infoStepAvailable === true),
    diagnosticStepAvailable: governedFacts.some((fact) => fact.diagnosticStepAvailable === true),
    oversightRequired: governedFacts.some((fact) => fact.oversightRequired === true),
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
