import type { SolandraExplanationPlan } from "./types.js";

function labelsFor(plan: SolandraExplanationPlan, ids: readonly string[]): string[] {
  const labels = new Map(plan.candidates.map((candidate) => [candidate.candidateId, candidate.label]));
  return ids.map((id) => labels.get(id)).filter((value): value is string => value !== undefined);
}

function remainingAlternatives(plan: SolandraExplanationPlan): string {
  const labels = labelsFor(plan, plan.frontierCandidateIds);
  return labels.length > 0 ? ` Alternatives still under consideration: ${labels.join(", ")}.` : "";
}

export function renderCanonicalExplanation(plan: SolandraExplanationPlan): string {
  if (plan.winnerCandidateId) {
    const excluded = plan.candidates.filter((candidate) => !candidate.eligible);
    const eligible = plan.candidates.filter((candidate) => candidate.eligible);
    const hardRequirementExplanation = excluded.length > 0
      ? ` ${excluded.map((candidate) => candidate.label).join(", ")} ${excluded.length === 1 ? "was" : "were"} excluded because admitted evidence did not satisfy every confirmed hard requirement.`
      : "";
    const preferenceExplanation = eligible.length > 1
      ? ` Among the eligible alternatives, the qualified preference comparison favors ${plan.winnerLabel}.`
      : "";
    return `Solandra recommends ${plan.winnerLabel}. The admitted evidence supports that recommendation under the requirements and priorities you confirmed.${hardRequirementExplanation}${preferenceExplanation}`;
  }

  switch (plan.outcome) {
    case "FRONTIER":
      return `I can't justify a unique recommendation from the confirmed priorities.${remainingAlternatives(plan)}`;
    case "TIE":
      return `I can't justify a unique recommendation because the qualified comparison found no meaningful difference.${remainingAlternatives(plan)}`;
    case "INSUFFICIENT_EVIDENCE":
      return `I can't justify a unique recommendation yet because required admitted evidence is missing.${remainingAlternatives(plan)}`;
    case "UNRESOLVED":
      return `I can't justify a unique recommendation because a material qualified comparison remains unresolved.${remainingAlternatives(plan)}`;
    case "NO_ELIGIBLE_CANDIDATE":
      return "I can't recommend an alternative because none is known to satisfy all confirmed hard requirements.";
    case "RECOMMENDATION":
      throw new Error("A recommendation explanation requires an exact winner.");
  }
}
