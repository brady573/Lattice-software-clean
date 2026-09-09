import { createHash } from "node:crypto";
import type { RecommendationRecord } from "./recommendation-store.js";

export interface RecommendationOption {
  optionId: string;
  position: number;
  text: string;
  recommended: boolean;
}

function stableOptionId(recommendationId: string, position: number, text: string): string {
  const digest = createHash("sha256")
    .update([recommendationId, String(position), text].join("\u001f"))
    .digest("hex")
    .slice(0, 40);
  return `recommendation_option_${digest}`;
}

export function recommendationOptions(record: RecommendationRecord): RecommendationOption[] {
  const texts = [record.recommendation, ...record.alternatives];
  return texts.map((text, index) => Object.freeze({
    optionId: stableOptionId(record.recommendationId, index + 1, text),
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
