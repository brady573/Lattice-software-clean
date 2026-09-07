import { isConsultationRunRequest, type LatticeRun } from "../domain.js";
import { buildKnowledgeOutcome, type KnowledgeOutcome } from "../outcome.js";
import type { RunStore } from "../run-store.js";
import type { SolandraGovernedKnowledgeContext } from "../solandra/cognition.js";
import type { TruthBundle } from "../truth/types.js";
import {
  buildConversationKnowledgeReference,
  buildKnowledgeRecord,
  type ConversationKnowledgeReference,
  type KnowledgeRecord,
  type KnowledgeRecordStore,
} from "./knowledge-record-store.js";

export interface LoadedKnowledge {
  record: KnowledgeRecord;
  run: LatticeRun;
  truth: TruthBundle;
  knowledge: KnowledgeOutcome;
}

function equalSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const l = [...left].sort();
  const r = [...right].sort();
  return l.every((value, index) => value === r[index]);
}

function assertRecordIntegrity(loaded: LoadedKnowledge): void {
  const { record, run, truth, knowledge } = loaded;
  if (!isConsultationRunRequest(run.request)) throw new Error("Knowledge record Run is not a consultation.");
  if (run.conversationId !== record.conversationId) throw new Error("Knowledge record conversation binding changed.");
  if (run.request.intentScopeId !== record.intentScopeId || run.request.intentVersionId !== record.intentVersionId) {
    throw new Error("Knowledge record authoritative IntentVersion binding changed.");
  }
  if (truth.runId !== record.runId || run.id !== record.runId) throw new Error("Knowledge record Run/Truth binding changed.");
  if (knowledge.objective !== record.objective) throw new Error("Knowledge record objective changed.");
  if (!equalSet(knowledge.findings.map((finding) => finding.claimId), record.claimIds)) {
    throw new Error("Knowledge record claim references no longer match V36-backed Knowledge.");
  }
  if (!equalSet(knowledge.truthAssessmentIds, record.truthAssessmentIds)) {
    throw new Error("Knowledge record truth-assessment references no longer match V36-backed Knowledge.");
  }
  const evidenceIds = knowledge.findings.flatMap((finding) => [
    ...finding.evidenceIds,
    ...finding.contradictoryEvidenceIds,
  ]);
  if (!equalSet([...new Set(evidenceIds)], record.evidenceIds)) {
    throw new Error("Knowledge record evidence references no longer match V36-backed Knowledge.");
  }
  const usedEvidence = new Set(record.evidenceIds);
  const sourceIds = [...new Set((knowledge.evidence ?? [])
    .filter((item) => usedEvidence.has(item.evidenceId))
    .map((item) => item.sourceId))];
  if (!equalSet(sourceIds, record.sourceIds)) {
    throw new Error("Knowledge record source references no longer match V36-backed Knowledge.");
  }
}

export async function loadKnowledge(
  store: KnowledgeRecordStore,
  runStore: RunStore,
  knowledgeId: string,
): Promise<LoadedKnowledge | undefined> {
  const record = await store.getKnowledge(knowledgeId);
  if (!record) return undefined;
  const run = await runStore.get(record.runId);
  if (!run || run.status !== "COMPLETED") return undefined;
  const truth = await runStore.getTruthBundle(run.id);
  if (!truth) return undefined;
  const knowledge = buildKnowledgeOutcome(run, truth);
  const loaded = { record, run, truth, knowledge };
  assertRecordIntegrity(loaded);
  return loaded;
}

export async function establishKnowledge(
  store: KnowledgeRecordStore,
  run: LatticeRun,
  truth: TruthBundle,
  knowledge: KnowledgeOutcome,
): Promise<{ record: KnowledgeRecord; reference: ConversationKnowledgeReference }> {
  let record = await store.getKnowledgeByRunId(run.id);
  if (!record) {
    const candidate = buildKnowledgeRecord(run, truth, knowledge);
    try {
      record = await store.putKnowledge(candidate);
    } catch (error) {
      // Concurrent outcome reads may race while establishing the same durable
      // Knowledge identity. Reuse only a winner that still proves the exact
      // Run/Intent/V36 bindings; any genuine rebind remains a hard failure.
      const raced = await store.getKnowledgeByRunId(run.id);
      if (!raced) throw error;
      assertRecordIntegrity({ record: raced, run, truth, knowledge });
      record = raced;
    }
  }
  assertRecordIntegrity({ record, run, truth, knowledge });

  const references = await store.listReferences(run.conversationId);
  const responseId = `run:${run.id}:outcome`;
  const existingReference = references.find((reference) =>
    reference.referenceKind === "ESTABLISHED"
    && reference.userMessageId === record.sourceMessageId
    && reference.responseId === responseId
    && reference.knowledgeId === record.knowledgeId);
  if (existingReference) return { record, reference: existingReference };

  const latest = references.at(-1);
  const reference = await store.putReference(buildConversationKnowledgeReference({
    conversationId: run.conversationId,
    userMessageId: record.sourceMessageId,
    responseId,
    intentVersionId: record.intentVersionId,
    knowledgeId: record.knowledgeId,
    referenceKind: "ESTABLISHED",
    parentReferenceId: latest?.referenceId ?? null,
    createdAt: record.createdAt,
  }));
  return { record, reference };
}

export async function referenceKnowledge(
  store: KnowledgeRecordStore,
  input: {
    knowledge: KnowledgeRecord;
    userMessageId: string;
    intentVersionId: string;
    createdAt: string;
  },
): Promise<ConversationKnowledgeReference> {
  const latest = await store.latestReference(input.knowledge.conversationId);
  const draft = buildConversationKnowledgeReference({
    conversationId: input.knowledge.conversationId,
    userMessageId: input.userMessageId,
    responseId: `knowledge:${input.knowledge.knowledgeId}:reference:${input.userMessageId}`,
    intentVersionId: input.intentVersionId,
    knowledgeId: input.knowledge.knowledgeId,
    referenceKind: "REFERENCED",
    parentReferenceId: latest?.referenceId ?? null,
    createdAt: input.createdAt,
  });
  return await store.putReference(draft);
}

export function governedKnowledgeContext(loaded: LoadedKnowledge): SolandraGovernedKnowledgeContext {
  return Object.freeze({
    knowledgeId: loaded.record.knowledgeId,
    objective: loaded.record.objective,
    findings: loaded.knowledge.findings.map((finding) => Object.freeze({
      claimId: finding.claimId,
      text: finding.text,
      status: finding.status,
    })),
    sourceCount: loaded.record.sourceIds.length,
    uncertainties: [...loaded.record.uncertainties],
  });
}

export async function recentGovernedKnowledge(
  store: KnowledgeRecordStore,
  runStore: RunStore,
  conversationId: string,
  limit = 4,
): Promise<LoadedKnowledge[]> {
  const references = await store.listReferences(conversationId);
  const knowledgeIds = [...references]
    .reverse()
    .map((reference) => reference.knowledgeId)
    .filter((knowledgeId, index, values) => values.indexOf(knowledgeId) === index)
    .slice(0, limit);
  const loaded = await Promise.all(knowledgeIds.map((knowledgeId) => loadKnowledge(store, runStore, knowledgeId)));
  return loaded.filter((item): item is LoadedKnowledge => item !== undefined);
}

export function renderHistoricalSources(loaded: LoadedKnowledge): string {
  const sourceIds = new Set(loaded.record.sourceIds);
  const sources = loaded.knowledge.provenance.filter((source) => sourceIds.has(source.sourceId));
  if (sources.length === 0) return "I don't have an admitted source linked to that established Knowledge.";
  const lines = sources.map((source) => {
    const title = source.title?.trim() || source.canonicalUri;
    const publisher = source.publisher ? ` — ${source.publisher}` : "";
    return `- ${title}${publisher}\n  ${source.canonicalUri}`;
  });
  return `Sources for that established Knowledge:\n${lines.join("\n")}`;
}
