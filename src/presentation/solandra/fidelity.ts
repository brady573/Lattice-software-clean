import type { Candidate, StructuredDecision } from "../../domain.js";
import type { TruthBundle } from "../../truth/types.js";
import { createSolandraExplanationPlan } from "./plan.js";
import { renderCanonicalExplanation } from "./renderer.js";
import type { SolandraExplanationPlan } from "./types.js";

export function assertSolandraPlanFidelity(
  plan: SolandraExplanationPlan,
  decision: StructuredDecision,
  candidates: readonly Candidate[],
  bundle: TruthBundle,
): void {
  const expected = createSolandraExplanationPlan(decision, candidates, bundle);
  if (JSON.stringify(plan) !== JSON.stringify(expected)) {
    throw new Error("Solandra explanation plan diverges from persisted structured authority.");
  }
}

export function assertSolandraExplanationFidelity(
  explanation: string,
  plan: SolandraExplanationPlan,
  decision: StructuredDecision,
  candidates: readonly Candidate[],
  bundle: TruthBundle,
): void {
  assertSolandraPlanFidelity(plan, decision, candidates, bundle);
  const canonical = renderCanonicalExplanation(plan);
  if (explanation !== canonical) {
    throw new Error("Explanation diverges from the fidelity-valid Solandra plan or introduces unsupported material content.");
  }
}
