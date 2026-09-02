import { priorityTierSchema } from "../decision/priority-and-requirements.js";
import {
  emptyGeneralizedDecisionIntentState,
  type GeneralizedDecisionIntentVersion,
} from "./generalized-decision-semantics.js";
import type { IntentState } from "./types.js";

const REQUIREMENT_KEY_PATTERN = /^(.+)::(max|min|eq)$/;

function operatorForSuffix(suffix: string): "LTE" | "GTE" | "EQ" {
  if (suffix === "max") return "LTE";
  if (suffix === "min") return "GTE";
  return "EQ";
}

/**
 * Project already-authoritative generic Intent Authority state (arbitrary
 * REQUIREMENT/PREFERENCE keys naming USER-supplied criterion ids) into
 * generalized Decision Engine semantics.
 *
 * This performs no natural-language interpretation and invents no criterion,
 * domain, or product vocabulary: it only reads a structural key convention
 * (`<criterionId>::max|min|eq` for a confirmed hard requirement) and a
 * priority-tier value already confirmed by Intent Authority. Any REQUIREMENT
 * or PREFERENCE entry that does not match this generic convention is left
 * unresolved rather than guessed.
 */
export function deriveGeneralizedDecisionIntentFromState(
  intentScopeId: string,
  intentVersionId: string,
  state: IntentState,
): GeneralizedDecisionIntentVersion {
  if (
    !state.objective
    || state.objective.value.state !== "VALUE"
    || typeof state.objective.value.value !== "string"
  ) {
    throw new Error("Generalized decision projection requires a confirmed USER objective.");
  }

  const decisionSemantics = emptyGeneralizedDecisionIntentState();

  for (const [key, field] of Object.entries(state.requirements)) {
    const match = REQUIREMENT_KEY_PATTERN.exec(key);
    if (!match || field.value.state !== "VALUE") continue;
    const criterionId = match[1] as string;
    const suffix = match[2] as string;
    decisionSemantics.hardRequirements[criterionId] = {
      value: { operator: operatorForSuffix(suffix), expected: field.value.value },
      provenance: field.provenance,
    };
  }

  for (const [criterionId, field] of Object.entries(state.preferences)) {
    if (field.value.state !== "VALUE" || typeof field.value.value !== "string") continue;
    const tier = priorityTierSchema.safeParse(field.value.value);
    if (!tier.success) continue;
    decisionSemantics.priorities[criterionId] = {
      value: { state: "VALUE", tier: tier.data },
      provenance: field.provenance,
    };
  }

  return {
    intentScopeId,
    intentVersionId,
    objective: { value: state.objective.value.value, provenance: state.objective.provenance },
    decisionSemantics,
  };
}
