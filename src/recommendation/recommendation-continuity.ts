import { isConsultationRunRequest, type LatticeRun } from "../domain.js";
import type { IntentUserMessage } from "../intent/source-message-store.js";
import type { IntentVersion } from "../intent/types.js";
import {
  loadKnowledge,
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
  type RecommendationBasis,
  type RecommendationRecord,
  type RecommendationStore,
} from "./recommendation-store.js";
import { recommendationOptions } from "./recommendation-options.js";

export interface LoadedRecommendation {
  record: RecommendationRecord;
  knowledge: LoadedKnowledge[];
}

export interface RecommendationBasisTrace {
  knowledgeId: string;
  claimIds: string[];
  evidenceIds: string[];
  sourceIds: string[];
}

function equalSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const l = [...left].sort();
  const r = [...right].sort();
  return l.every((value, index) => value === r[index]);
}

function equalArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function latestKnowledgeCreationTime(knowledge: readonly LoadedKnowledge[]): string {
  const dates = knowledge
    .map((item) => new Date(item.record.createdAt))
    .filter((date) => !Number.isNaN(date.valueOf()))
    .sort((left, right) => right.valueOf() - left.valueOf());
  const latest = dates[0];
  if (!latest) throw new Error("Recommendation basis has no valid governed Knowledge creation time.");
  return latest.toISOString();
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

function exactUserExcerpt(value: string, material: readonly string[]): string | undefined {
  const candidate = value.trim();
  if (!candidate) return undefined;
  return material.some((item) => item.includes(candidate)) ? candidate : undefined;
}

function userOptionProjection(
  advisory: SolandraRecommendationResult,
  userMaterial: readonly string[],
): Readonly<{ recommendation: string; alternatives: string[]; assumptions: string[] }> {
  const recommendation = exactUserExcerpt(advisory.recommendation, userMaterial);
  if (!recommendation) {
    throw new Error(
      "Recommendation durable option text must be an exact excerpt of authoritative USER material; generated option prose is non-durable.",
    );
  }

  const alternatives = advisory.alternatives
    .map((item) => exactUserExcerpt(item, userMaterial))
    .filter((item): item is string => item !== undefined)
    .filter((item, index, values) => item !== recommendation && values.indexOf(item) === index);

  const assumptions = advisory.assumptions
    .map((item) => exactUserExcerpt(item, userMaterial))
    .filter((item): item is string => item !== undefined)
    .filter((item, index, values) => values.indexOf(item) === index);

  return { recommendation, alternatives, assumptions };
}

function normalizedBasis(basis: readonly RecommendationBasis[]): RecommendationBasis[] {
  const byKnowledge = new Map<string, Set<string>>();
  for (const entry of basis) {
    const claims = byKnowledge.get(entry.knowledgeId) ?? new Set<string>();
    for (const claimId of entry.claimIds) claims.add(claimId);
    byKnowledge.set(entry.knowledgeId, claims);
  }
  return [...byKnowledge.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([knowledgeId, claimIds]) => ({ knowledgeId, claimIds: [...claimIds].sort() }));
}

function governedSupportLine(finding: LoadedKnowledge["knowledge"]["findings"][number]): string {
  if (finding.basis === "SOURCE_REPORT") {
    return `Source report (${finding.status.toLocaleLowerCase("en-US")}): ${finding.text}`;
  }
  switch (finding.status) {
    case "SUPPORTED": return finding.text;
    case "REFUTED": return `The governed evidence refutes this claim: ${finding.text}`;
    case "CONFLICTED": return `The governed evidence remains materially conflicted on this claim: ${finding.text}`;
    case "UNRESOLVED": return `The governed evidence does not establish this claim strongly enough: ${finding.text}`;
  }
}

function projectGovernedRecommendationMaterial(
  knowledge: readonly LoadedKnowledge[],
  basis: readonly RecommendationBasis[],
  conversationId: string,
): Readonly<{ rationale: string[]; uncertainties: string[] }> {
  const byId = new Map(knowledge.map((item) => [item.record.knowledgeId, item]));
  const rationale: string[] = [];
  const uncertainties: string[] = [];

  for (const basisItem of normalizedBasis(basis)) {
    const loaded = byId.get(basisItem.knowledgeId);
    if (!loaded || loaded.record.conversationId !== conversationId) {
      throw new Error("Recommendation basis must reference governed Knowledge supplied for the same conversation.");
    }
    const findings = new Map(loaded.knowledge.findings.map((finding) => [finding.claimId, finding]));
    for (const claimId of basisItem.claimIds) {
      if (!loaded.record.claimIds.includes(claimId)) {
        throw new Error("Recommendation basis contains a claim outside its governed Knowledge.");
      }
      const finding = findings.get(claimId);
      if (!finding) throw new Error("Recommendation exact claim basis cannot be projected from governed Knowledge.");
      rationale.push(governedSupportLine(finding));
    }
    for (const uncertainty of loaded.knowledge.uncertainties) {
      if (!uncertainties.includes(uncertainty)) uncertainties.push(uncertainty);
    }
  }
  return { rationale, uncertainties };
}

function assertPreservedGovernedUncertainty(
  advisory: SolandraRecommendationResult,
  governedUncertainties: readonly string[],
): void {
  const preserved = [...new Set(advisory.preservedUncertainties)];
  if (!equalSet(preserved, governedUncertainties)) {
    throw new Error("Solandra advisory reasoning dropped or invented material governed uncertainty from its Recommendation basis.");
  }
}

function runUserMaterial(run: LatticeRun): string[] {
  if (!isConsultationRunRequest(run.request)) return [];
  return [run.request.objective, ...run.request.context].map((item) => item.trim()).filter(Boolean);
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

  const existing = await input.store.getRecommendationByRunId(input.run.id);
  if (existing) return existing;

  const basis: RecommendationBasis[] = input.advisory.basis.map((item) => ({
    knowledgeId: item.knowledgeId,
    claimIds: [...item.claimIds],
  }));
  const governed = projectGovernedRecommendationMaterial(input.knowledge, basis, input.run.conversationId);
  assertPreservedGovernedUncertainty(input.advisory, governed.uncertainties);
  const user = userOptionProjection(input.advisory, runUserMaterial(input.run));

  const draft = buildRecommendationRecord({
    conversationId: input.run.conversationId,
    runId: input.run.id,
    intentScopeId: input.intentVersion.intentScopeId,
    intentVersionId: input.intentVersion.intentVersionId,
    sourceMessageId: input.run.request.sourceMessageId,
    basis,
    userMaterialBasis: [input.intentVersion.intentVersionId, input.run.request.sourceMessageId],
    recommendation: user.recommendation,
    rationale: governed.rationale,
    tradeoffs: [],
    assumptions: user.assumptions,
    uncertainties: governed.uncertainties,
    alternatives: user.alternatives,
    createdAt: input.createdAt
      ?? (input.knowledge.length > 0 ? latestKnowledgeCreationTime(input.knowledge) : input.intentVersion.createdAt),
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

export async function establishConversationalRecommendation(input: {
  store: RecommendationStore;
  conversationId: string;
  intentVersion: IntentVersion;
  sourceMessage: IntentUserMessage;
  knowledge: LoadedKnowledge[];
  advisory: SolandraRecommendationResult;
}): Promise<RecommendationRecord> {
  if (input.sourceMessage.conversationId !== input.conversationId) {
    throw new Error("Conversational Recommendation USER source binding changed.");
  }
  const basis: RecommendationBasis[] = input.advisory.basis.map((item) => ({
    knowledgeId: item.knowledgeId,
    claimIds: [...item.claimIds],
  }));
  const governed = projectGovernedRecommendationMaterial(input.knowledge, basis, input.conversationId);
  assertPreservedGovernedUncertainty(input.advisory, governed.uncertainties);
  const user = userOptionProjection(input.advisory, [input.sourceMessage.content]);

  const draft = buildRecommendationRecord({
    conversationId: input.conversationId,
    runId: null,
    intentScopeId: input.intentVersion.intentScopeId,
    intentVersionId: input.intentVersion.intentVersionId,
    sourceMessageId: input.sourceMessage.messageId,
    basis,
    userMaterialBasis: [input.intentVersion.intentVersionId, input.sourceMessage.messageId],
    recommendation: user.recommendation,
    rationale: governed.rationale,
    tradeoffs: [],
    assumptions: user.assumptions,
    uncertainties: governed.uncertainties,
    alternatives: user.alternatives,
    createdAt: input.sourceMessage.createdAt,
  });
  return input.store.putRecommendation(draft);
}

export async function loadRecommendation(
  store: RecommendationStore,
  knowledgeStore: KnowledgeRecordStore,
  runStore: RunStore,
  recommendationId: string,
): Promise<LoadedRecommendation | undefined> {
  const record = await store.getRecommendation(recommendationId);
  if (!record) return undefined;

  const authoritativeKnowledgeBasis = record.premiseAuthority.knowledge;
  if (JSON.stringify(authoritativeKnowledgeBasis) !== JSON.stringify(record.basis)) {
    throw new Error("Recommendation factual premise authority no longer matches its exact Knowledge/claim basis.");
  }
  const expectedUserPremises = [{
    intentVersionId: record.intentVersionId,
    sourceMessageId: record.sourceMessageId,
  }];
  if (JSON.stringify(record.premiseAuthority.user) !== JSON.stringify(expectedUserPremises)) {
    throw new Error("Recommendation USER premise authority no longer matches its exact USER-material lineage.");
  }

  const basisKnowledgeIds = [...new Set(authoritativeKnowledgeBasis.map((item) => item.knowledgeId))];
  const basisClaimIds = [...new Set(authoritativeKnowledgeBasis.flatMap((item) => item.claimIds))];
  if (!equalSet(record.knowledgeIds, basisKnowledgeIds) || !equalSet(record.claimIds, basisClaimIds)) {
    throw new Error("Recommendation flattened basis no longer matches its exact Knowledge/claim relationship.");
  }

  const knowledge = await Promise.all(basisKnowledgeIds.map((knowledgeId) => loadKnowledge(knowledgeStore, runStore, knowledgeId)));
  if (knowledge.some((item) => item === undefined)) throw new Error("Recommendation governed Knowledge could not be reconstructed.");
  const loaded = knowledge as LoadedKnowledge[];
  if (loaded.some((item) => item.record.conversationId !== record.conversationId)) {
    throw new Error("Recommendation Knowledge conversation binding changed.");
  }
  const loadedById = new Map(loaded.map((item) => [item.record.knowledgeId, item]));
  for (const basis of authoritativeKnowledgeBasis) {
    const item = loadedById.get(basis.knowledgeId);
    if (!item || basis.claimIds.some((claimId) => !item.record.claimIds.includes(claimId))) {
      throw new Error("Recommendation exact claim basis no longer resolves through its governed Knowledge.");
    }
  }

  if (record.representationKind === "STRUCTURAL_USER_MATERIAL_V1") {
    const governed = projectGovernedRecommendationMaterial(loaded, record.basis, record.conversationId);
    if (!equalArray(record.rationale, governed.rationale) || !equalArray(record.uncertainties, governed.uncertainties)) {
      throw new Error("Recommendation durable factual presentation no longer matches its exact governed premise material.");
    }
    if (record.tradeoffs.length !== 0) {
      throw new Error("Structural Recommendation cannot persist arbitrary free-form tradeoff prose.");
    }
  }

  if (record.runId !== null) {
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
    if (record.representationKind === "STRUCTURAL_USER_MATERIAL_V1") {
      const material = runUserMaterial(run);
      if (!exactUserExcerpt(record.recommendation, material)) {
        throw new Error("Recommendation durable option no longer resolves to exact USER material.");
      }
      for (const value of [...record.alternatives, ...record.assumptions]) {
        if (!exactUserExcerpt(value, material)) {
          throw new Error("Recommendation durable USER-derived material no longer resolves to exact USER material.");
        }
      }
    }
  } else if (record.premiseAuthority.user.length === 0) {
    throw new Error("Run-free Recommendation is missing exact USER-material premise authority.");
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

export function recommendationBasisTrace(loaded: LoadedRecommendation): RecommendationBasisTrace[] {
  const byId = new Map(loaded.knowledge.map((item) => [item.record.knowledgeId, item]));
  return loaded.record.premiseAuthority.knowledge.map((basis) => {
    const knowledge = byId.get(basis.knowledgeId);
    if (!knowledge) throw new Error("Recommendation basis Knowledge is unavailable for provenance traversal.");
    const claims = new Set(basis.claimIds);
    const evidenceIds = [...new Set(knowledge.knowledge.findings
      .filter((finding) => claims.has(finding.claimId))
      .flatMap((finding) => [...finding.evidenceIds, ...finding.contradictoryEvidenceIds]))];
    const admittedEvidenceIds = new Set((knowledge.knowledge.evidence ?? [])
      .filter((evidence) => evidence.admitted && evidenceIds.includes(evidence.evidenceId))
      .map((evidence) => evidence.evidenceId));
    const sourceIds = [...new Set((knowledge.knowledge.evidence ?? [])
      .filter((evidence) => admittedEvidenceIds.has(evidence.evidenceId))
      .map((evidence) => evidence.sourceId))];
    return {
      knowledgeId: basis.knowledgeId,
      claimIds: [...basis.claimIds],
      evidenceIds: [...admittedEvidenceIds],
      sourceIds,
    };
  });
}

export function renderRecommendation(record: RecommendationRecord): string {
  if (record.representationKind === "LEGACY_FREEFORM") {
    return "This earlier Recommendation predates the current structural factual-trust boundary, so I won't reproduce its free-form text. Revisit the decision to establish a current Recommendation.";
  }

  const sections = [`I favor: ${record.recommendation}`];
  if (record.alternatives.length > 0) {
    const ranked = recommendationOptions(record)
      .slice(1)
      .map((item) => `${item.position}. ${item.text}`)
      .join("\n");
    sections.push(`I would rank the other USER-supplied options next:\n${ranked}`);
  }
  if (record.assumptions.length > 0) {
    sections.push(`From your message:\n${record.assumptions.map((item) => `- ${item}`).join("\n")}`);
  }
  if (record.rationale.length > 0) {
    sections.push(`Established support:\n${record.rationale.map((item) => `- ${item}`).join("\n")}`);
  }
  if (record.uncertainties.length > 0) {
    sections.push(`Known uncertainty:\n${record.uncertainties.map((item) => `- ${item}`).join("\n")}`);
  }
  sections.push("This ranking is advisory judgment over the USER premises and governed support above. If your stated priorities or premises change, the recommendation may change.");
  return sections.join("\n\n");
}

export function renderHistoricalRecommendationExplanation(loaded: LoadedRecommendation): string {
  return renderRecommendation(loaded.record);
}

export function renderHistoricalRecommendationSources(loaded: LoadedRecommendation): string {
  const traces = recommendationBasisTrace(loaded);
  const sourceKeys = new Set(traces.flatMap((trace) => trace.sourceIds.map((sourceId) => `${trace.knowledgeId}\u001f${sourceId}`)));
  const sources = loaded.knowledge.flatMap((knowledge) => knowledge.knowledge.provenance
    .filter((source) => sourceKeys.has(`${knowledge.record.knowledgeId}\u001f${source.sourceId}`)));
  if (sources.length === 0) return "I don't have admitted evidence/source provenance linked to the exact claims used by that recommendation.";
  const unique = sources.filter((source, index, values) =>
    values.findIndex((candidate) => candidate.sourceId === source.sourceId && candidate.canonicalUri === source.canonicalUri) === index);
  const lines = unique.map((source) => {
    const title = source.title?.trim() || source.canonicalUri;
    const publisher = source.publisher ? ` — ${source.publisher}` : "";
    return `- ${title}${publisher}\n  ${source.canonicalUri}`;
  });
  return `Sources for the exact governed claim basis used by that recommendation:\n${lines.join("\n")}`;
}

export function recommendationContext(record: RecommendationRecord): Readonly<{
  recommendationId: string;
  recommendation: string;
  intentVersionId: string;
  knowledgeIds: string[];
  createdAt: string;
  options: ReturnType<typeof recommendationOptions>;
}> {
  return Object.freeze({
    recommendationId: record.recommendationId,
    recommendation: record.recommendation,
    intentVersionId: record.intentVersionId,
    knowledgeIds: [...record.knowledgeIds],
    createdAt: record.createdAt,
    options: recommendationOptions(record),
  });
}
