import type { RecommendationRecord } from "./recommendation-store.js";

export interface RecommendationOption {
  optionId: string;
  position: number;
  text: string;
  recommended: boolean;
}

export function recommendationOptions(record: RecommendationRecord): RecommendationOption[] {
  const texts = [record.recommendation, ...record.alternatives];
  if (record.optionIds.length !== texts.length) {
    throw new Error("Recommendation option identity no longer matches its durable option set.");
  }
  return texts.map((text, index) => Object.freeze({
    optionId: record.optionIds[index]!,
    position: index + 1,
    text,
    recommended: index === 0,
  }));
}

export function recommendationOption(
  record: RecommendationRecord,
  optionId: string,
): RecommendationOption | undefined {
  return recommendationOptions(record).find((option) => option.optionId === optionId);
}
