import type { IntentAuthorityStore } from "./store.js";

export interface DecisionPlanBindingInput {
  decisionPlanId: string;
  intentScopeId: string;
  intentVersionId: string;
  planningMaterial: Record<string, unknown>;
}

export interface IntentBoundDecisionPlan extends DecisionPlanBindingInput {
  boundAt: string;
}

/**
 * Bind downstream DecisionPlan material to one existing exact IntentVersion.
 *
 * This function does not interpret USER text, generate planning semantics, mutate
 * canonical intent, or imply that the planning material is semantically faithful.
 * It only establishes the exact immutable IntentScope + IntentVersion identity
 * required by OD-004 before downstream planning material can be treated as bound.
 */
export async function bindDecisionPlanToExactIntentVersion(
  intentStore: IntentAuthorityStore,
  input: DecisionPlanBindingInput,
): Promise<IntentBoundDecisionPlan> {
  if (input.decisionPlanId.trim().length === 0) {
    throw new Error("DecisionPlan identity must be non-empty.");
  }
  if (input.intentScopeId.trim().length === 0 || input.intentVersionId.trim().length === 0) {
    throw new Error("DecisionPlan must bind a non-empty exact IntentScope and IntentVersion identity.");
  }

  const version = await intentStore.getVersion(input.intentVersionId);
  if (!version || version.intentScopeId !== input.intentScopeId) {
    throw new Error("DecisionPlan must bind an existing exact IntentVersion in the requested IntentScope.");
  }

  return {
    decisionPlanId: input.decisionPlanId,
    intentScopeId: input.intentScopeId,
    intentVersionId: input.intentVersionId,
    planningMaterial: structuredClone(input.planningMaterial),
    boundAt: new Date().toISOString(),
  };
}
