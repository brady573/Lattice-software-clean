import type { SolandraExplanationPlan } from "./types.js";

export function renderCanonicalExplanation(plan: SolandraExplanationPlan): string {
  const excluded = plan.candidates.filter((candidate) => !candidate.eligible);
  const exclusions = excluded.length > 0
    ? ` ${excluded.length} candidate(s) were excluded because admitted evidence did not satisfy every hard constraint.`
    : "";
  return `Solandra recommends ${plan.winnerLabel}. It satisfies every hard constraint and has the strongest weighted preference score among the remaining eligible candidates.${exclusions}`;
}
