import type { RecommendationRecord } from "./recommendation-store.js";

export interface RecommendationOption {
  optionId: string;
  position: number;
  text: string;
  recommended: boolean;
}

export function recommendationOptions(record: RecommendationRecord): RecommendationOption[] {
  const byId = new Map(record.proposals.map((proposal) => [proposal.proposalId, proposal]));
  if (
    record.rankedProposalIds.length !== record.proposals.length
    || record.rankedProposalIds[0] !== record.recommendedProposalId
    || new Set(record.rankedProposalIds).size !== record.rankedProposalIds.length
  ) {
    throw new Error("Recommendation proposal ranking no longer matches its durable proposal set.");
  }
  return record.rankedProposalIds.map((proposalId, index) => {
    const proposal = byId.get(proposalId);
    if (!proposal) throw new Error("Recommendation proposal identity no longer resolves to durable proposal material.");
    return Object.freeze({
      optionId: proposal.proposalId,
      position: index + 1,
      text: proposal.text,
      recommended: proposal.proposalId === record.recommendedProposalId,
    });
  });
}

export function recommendationOption(
  record: RecommendationRecord,
  optionId: string,
): RecommendationOption | undefined {
  return recommendationOptions(record).find((option) => option.optionId === optionId);
}
