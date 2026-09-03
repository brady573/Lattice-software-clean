import type { SolandraExplanationPlan } from "./types.js";

export function renderCanonicalExplanation(plan: SolandraExplanationPlan): string {
  if (plan.winnerCandidateId) {
    const excluded = plan.candidates.filter((candidate) => !candidate.eligible);
    const exclusions = excluded.length > 0
      ? ` ${excluded.length} candidate(s) were excluded because admitted evidence did not satisfy every hard constraint.`
      : "";
    return `Solandra recommends ${plan.winnerLabel}. It satisfies every hard constraint and has the strongest weighted preference score among the remaining eligible candidates.${exclusions}`;
  }
  return [
    `Solandra reports ${plan.outcome.toLowerCase().replaceAll("_", " ")}.`,
    plan.frontierCandidateIds.length > 0 ? `Authoritative frontier: ${plan.frontierCandidateIds.join(", ")}.` : "",
    ...plan.materialUnknowns.map((item) => `Unresolved: ${item}.`),
  ].filter(Boolean).join(" ");
}
