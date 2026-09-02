import type { QualifiedCriterionCatalog } from "../decision/criterion-catalog.js";
import {
  buildDecisionInputSnapshot,
  type DecisionInputSnapshot,
  type ExactDecisionIntentSemantics,
} from "../decision/decision-input-snapshot.js";
import {
  generalizedDecisionIntentVersionSchema,
  type GeneralizedDecisionIntentVersion,
} from "./generalized-decision-semantics.js";

/**
 * Project already-authoritative generalized Intent Authority state into the
 * Decision Engine's exact planning input contract.
 *
 * NO_PREFERENCE is intentionally omitted because it contributes no active
 * preference constraint. OPEN and DELEGATED cannot be silently converted into
 * a priority tier or tolerance, so planning fails closed until a later contract
 * gives those states an explicit Decision Engine meaning.
 */
export function buildDecisionInputFromGeneralizedIntent(
  rawIntent: GeneralizedDecisionIntentVersion,
  catalog: QualifiedCriterionCatalog,
): DecisionInputSnapshot {
  const intent = generalizedDecisionIntentVersionSchema.parse(rawIntent);

  const priorities: ExactDecisionIntentSemantics["priorities"] = [];
  for (const [criterionId, field] of Object.entries(intent.decisionSemantics.priorities).sort(([a], [b]) => a.localeCompare(b))) {
    if (field.value.state === "VALUE") {
      priorities.push({ criterionId, tier: field.value.tier });
      continue;
    }
    if (field.value.state === "NO_PREFERENCE") continue;
    throw new Error(
      `Cannot build DecisionInput while priority ${criterionId} is ${field.value.state}; exact Decision Engine semantics are unresolved.`,
    );
  }

  const tolerances: ExactDecisionIntentSemantics["tolerances"] = [];
  for (const [criterionId, field] of Object.entries(intent.decisionSemantics.tolerances).sort(([a], [b]) => a.localeCompare(b))) {
    if (field.value.state === "VALUE") {
      tolerances.push({
        criterionId,
        kind: field.value.kind,
        maximumDifference: field.value.maximumDifference,
      });
      continue;
    }
    if (field.value.state === "NO_PREFERENCE") continue;
    throw new Error(
      `Cannot build DecisionInput while tolerance ${criterionId} is ${field.value.state}; exact Decision Engine semantics are unresolved.`,
    );
  }

  const hardRequirements: ExactDecisionIntentSemantics["hardRequirements"] = Object.entries(
    intent.decisionSemantics.hardRequirements,
  )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([criterionId, field]) => ({
      criterionId,
      operator: field.value.operator,
      expected: field.value.expected,
    }));

  return buildDecisionInputSnapshot({
    intentScopeId: intent.intentScopeId,
    intentVersionId: intent.intentVersionId,
    objective: intent.objective.value,
    hardRequirements,
    priorities,
    tolerances,
  }, catalog);
}
