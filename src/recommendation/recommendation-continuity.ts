import { isConsultationRunRequest, type LatticeRun } from "../domain.js";
import type { IntentVersion } from "../intent/types.js";
import {
  loadKnowledge,
  renderHistoricalSources,
  type LoadedKnowledge,
} from "../knowledge/knowledge-continuity.js";
import type { KnowledgeRecordStore } from "../knowledge/knowledge-record-store.js";
import type { RunStore } from "../run-store.js";
import type {
  SolandraAdvisoryKnowledge,
  SolandraRecommendationResult,
} from "../solandra/advisory.js";
import {
  buildRecommendationRecord,
  type RecommendationRecord,
  type RecommendationStore,
} from "./recommendation-store.js";

export interface LoadedRecommendation {
  record: RecommendationRecord;
  knowledge: LoadedKnowledge[];
}

function equalSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const l = [...left].sort();
  const r = [...right].sort();
  return l.every((value, index) => value === r[index]);
}

export function advisoryKnowledge(loaded: LoadedKnowledge): SolandraAdvisoryKnowledge {
  return Object.freeze({
    knowledgeId: loaded.record.knowledgeId,
    objective: loaded.record.objective,
    findings: loaded.knowledge.findings.map((finding) => Object.freeze({
      claimId: finding.claimId,
      text: finding.text,
      status: finding.status,
      confidence: finding.confidence,
    })),
    uncertainties: [...loaded.knowledge.uncertainties],
    asOf: loaded.record.asOf,
  });
}

export async function establishRecommendation(input: {
  store: RecommendationStore;
  run: LatticeRun;
  intentVersion: IntentVersion;
  knowledge: LoadedKnowledge[];
  advisory: SolandraRecommendationResult;
  createdAt?: string;
}): Promise<RecommendationRecord> {
  if (!isConsultationRunRequest(input.run.request) || !input.run.request.advisoryRequested) {
    throw new Error("First-class Recommendation requires a canonical advisory consultation Run.");
  }
  if (input.run.status !== "COMPLETED") throw new Error("Recommendation requires a completed governed Run.");
  if (
    input.run.request.intentScopeId !== input.intentVersion.intentScopeId
    || input.run.request.intentVersionId !== input.intentVersion.intentVersionId
  ) {
    throw new Error("Recommendation authoritative IntentVersion binding changed.");
  }
  const loadedById = new Map(input.knowledge.map((item) => [item.record.knowledgeId, item]));
  const knowledgeIds = input.advisory.basis.map((item) => item.knowledgeId);
  const claimIds = input.advisory.basis.flatMap((item) => item.claimIds);
  for (const basis of input.advisory.basis) {
    const loaded = loadedById.get(basis.knowledgeId);
    if (!loaded || loaded.record.conversationId !== input.run.conversationId) {
      throw new Error("Recommendation basis must reference governed Knowledge supplied for the same conversation.");
    }
    const allowedClaims = new Set(loaded.record.claimIds);
    if (basis.claimIds.some((claimId) => !allowedClaims.has(claimId))) {
      throw new Error("Recommendation basis contains a claim outside its governed Knowledge.");
    }
  }
  const draft = buildRecommendationRecord({
    conversationId: input.run.conversationId,
    runId: input.run.id,
    intentScopeId: input.intentVersion.intentScopeId,
    intentVersionId: input.intentVersion.intentVersionId,
    sourceMessageId: input.run.request.sourceMessageId,
    knowledgeIds,
    claimIds,
    recommendation: input.advisory.recommendation,
    rationale: input.advisory.rationale,
    tradeoffs: input.advisory.tradeoffs,
    assumptions: input.advisory.assumptions,
    uncertainties: [...new Set([...input.advisory.preservedUncertainties, ...input.advisory.uncertainties])],
    alternatives: input.advisory.alternatives,
    createdAt: input.createdAt ?? new Date().toISOString(),
  });
  try {
    return await input.store.putRecommendation(draft);
  } catch (error) {
    const raced = await input.store.getRecommendationByRunId(input.run.id);
    if (!raced) throw error;
    if (raced.recommendationId !== draft.recommendationId || JSON.stringify(raced) !== JSON.stringify(draft)) {
      throw error;
    }
    return raced;
  }
}

export async function loadRecommendation(
  store: RecommendationStore,
  knowledgeStore: KnowledgeRecordStore,
  runStore: RunStore,
  recommendationId: string,
): Promise<LoadedRecommendation | undefined> {
  const record = await store.getRecommendation(recommendationId);
  if (!record) return undefined;
  const knowledge = await Promise.all(record.knowledgeIds.map((knowledgeId) => loadKnowledge(knowledgeStore, runStore, knowledgeId)));
  if (knowledge.some((item) => item === undefined)) throw new Error("Recommendation governed Knowledge could not be reconstructed.");
  const loaded = knowledge as LoadedKnowledge[];
  if (loaded.some((item) => item.record.conversationId !== record.conversationId)) {
    throw new Error("Recommendation Knowledge conversation binding changed.");
  }
  const availableClaims = [...new Set(loaded.flatMap((item) => item.record.claimIds))];
  if (!record.claimIds.every((claimId) => availableClaims.includes(claimId))) {
    throw new Error("Recommendation claim binding no longer resolves through its governed Knowledge.");
  }
  const run = await runStore.get(record.runId);
  if (!run || !isConsultationRunRequest(run.request) || run.status !== "COMPLETED") {
    throw new Error("Recommendation source Run could not be reconstructed.");
  }
  if (
    run.conversationId !== record.conversationId
    || run.request.intentScopeId !== record.intentScopeId
    || run.request.intentVersionId !== record.intentVersionId
    || run.request.sourceMessageId !== record.sourceMessageId
  ) {
    throw new Error("Recommendation exact Run/Intent/USER-source binding changed.");
  }
  return { record, knowledge: loaded };
}

export async function loadRecommendationByRunId(
  store: RecommendationStore,
  knowledgeStore: KnowledgeRecordStore,
  runStore: RunStore,
  runId: string,
): Promise<LoadedRecommendation | undefined> {
  const record = await store.getRecommendationByRunId(runId);
  return record ? await loadRecommendation(store, knowledgeStore, runStore, record.recommendationId) : undefined;
}

export function renderRecommendation(record: RecommendationRecord): string {
  const sections = [record.recommendation];
  if (record.rationale.length > 0) sections.push(`Why:\n${record.rationale.map((item) => `- ${item}`).join("\n")}`);
  if (record.tradeoffs.length > 0) sections.push(`Tradeoffs:\n${record.tradeoffs.map((item) => `- ${item}`).join("\n")}`);
  if (record.assumptions.length > 0) sections.push(`Assumptions that could change the answer:\n${record.assumptions.map((item) => `- ${item}`).join("\n")}`);
  if (record.uncertainties.length > 0) sections.push(`Uncertainty:\n${record.uncertainties.map((item) => `- ${item}`).join("\n")}`);
  if (record.alternatives.length > 0) sections.push(`Alternatives worth considering:\n${record.alternatives.map((item) => `- ${item}`).join("\n")}`);
  return sections.join("\n\n");
}

export function renderHistoricalRecommendationExplanation(loaded: LoadedRecommendation): string {
  const record = loaded.record;
  return [
    `I recommended: ${record.recommendation}`,
    record.rationale.length > 0 ? `Why:\n${record.rationale.map((item) => `- ${item}`).join("\n")}` : "",
    record.tradeoffs.length > 0 ? `Tradeoffs:\n${record.tradeoffs.map((item) => `- ${item}`).join("\n")}` : "",
    record.assumptions.length > 0 ? `Assumptions:\n${record.assumptions.map((item) => `- ${item}`).join("\n")}` : "",
    record.uncertainties.length > 0 ? `Uncertainty:\n${record.uncertainties.map((item) => `- ${item}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
}

export function renderHistoricalRecommendationSources(loaded: LoadedRecommendation): string {
  const uniqueKnowledge = loaded.knowledge.filter((item, index, values) =>
    values.findIndex((candidate) => candidate.record.knowledgeId === item.record.knowledgeId) === index);
  return uniqueKnowledge.map(renderHistoricalSources).join("\n\n");
}

export function recommendationContext(record: RecommendationRecord): Readonly<{
  recommendationId: string;
  recommendation: string;
  intentVersionId: string;
  knowledgeIds: string[];
  createdAt: string;
}> {
  return Object.freeze({
    recommendationId: record.recommendationId,
    recommendation: record.recommendation,
    intentVersionId: record.intentVersionId,
    knowledgeIds: [...record.knowledgeIds],
    createdAt: record.createdAt,
  });
}
