import type { FastifyInstance } from "fastify";
import {
  preparedResourceFromRecord,
  type PreparedResourceStore,
} from "../action-preparation/prepared-resource-store.js";
import { getAuthenticatedSubject } from "../auth/authenticated-subject.js";
import { isConsultationRunRequest, type LatticeRunRequest } from "../domain.js";
import type {
  DecisionPlanStore,
  DecisionPlanningMaterial,
  DurableDecisionPlan,
} from "../intent/decision-plan-store.js";
import type { IntentAuthorityStore } from "../intent/store.js";
import type { IntentVersion } from "../intent/types.js";
import type { IntentUserMessageStore } from "../intent/source-message-store.js";
import type { KnowledgeRecordStore } from "../knowledge/knowledge-record-store.js";
import type { RecommendationStore } from "../recommendation/recommendation-store.js";
import { buildRunOutcome, type RunOutcome } from "../outcome.js";
import {
  composeSolandraPresentation,
  hydrateSolandraResource,
} from "../presentation/solandra-presentation.js";
import type { RunStore } from "../run-store.js";
import type { ConversationStore } from "./conversation-store.js";
import type { ConversationRunIndexStore } from "./run-index-store.js";

const CONVERSATION_ID_MAX_CHARS = 128;
const PRESENTATION_REVISION_MAX_CHARS = 128;
const RESOURCE_ID_MAX_CHARS = 256;

export interface ConversationContinuityApiOptions {
  conversationStore: ConversationStore;
  userMessageStore: IntentUserMessageStore;
  runStore: RunStore;
  runIndexStore: ConversationRunIndexStore;
  decisionPlanStore: DecisionPlanStore;
  intentStore?: IntentAuthorityStore;
  knowledgeStore?: KnowledgeRecordStore;
  recommendationStore?: RecommendationStore;
  preparedResourceStore?: PreparedResourceStore;
}

function validBoundedId(value: string, maxChars: number): string | undefined {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxChars) return undefined;
  return normalized;
}

async function readLatestPresentationBasis(
  conversationId: string,
  options: ConversationContinuityApiOptions,
): Promise<{
  run: Awaited<ReturnType<RunStore["get"]>>;
  decisionPlan: DurableDecisionPlan<DecisionPlanningMaterial> | undefined;
  intentVersion: IntentVersion | undefined;
  outcome: RunOutcome | undefined;
}> {
  const runIds = await options.runIndexStore.listRunIds(conversationId);
  for (let index = runIds.length - 1; index >= 0; index -= 1) {
    const runId = runIds[index];
    if (!runId) continue;
    const run = await options.runStore.get(runId);
    if (!run || run.conversationId !== conversationId) continue;
    const decisionPlan = await options.decisionPlanStore.getByRunId(run.id);
    const intentVersionId = isConsultationRunRequest(run.request)
      ? run.request.intentVersionId
      : decisionPlan?.intentVersionId;
    const intentVersion = intentVersionId && options.intentStore
      ? await options.intentStore.getVersion(intentVersionId)
      : undefined;
    const truth = run.status === "COMPLETED"
      ? await options.runStore.getTruthBundle(run.id)
      : undefined;
    let outcome = truth ? buildRunOutcome(run, truth) : undefined;
    if (
      outcome?.kind === "ACTION_PREPARATION"
      && outcome.resource.kind === "PREPARED_MESSAGE"
      && options.preparedResourceStore
    ) {
      const prepared = await options.preparedResourceStore.getPreparedResourceByRunId(run.id);
      if (prepared) outcome = { ...outcome, resource: preparedResourceFromRecord(prepared) };
    }
    return { run, decisionPlan, intentVersion, outcome };
  }
  return { run: undefined, decisionPlan: undefined, intentVersion: undefined, outcome: undefined };
}

export function registerConversationContinuityApi(
  app: FastifyInstance,
  options: ConversationContinuityApiOptions,
): void {
  app.get<{ Params: { conversationId: string } }>(
    "/api/v1/conversations/:conversationId/continuity",
    async (request, reply) => {
      const conversationId = validBoundedId(request.params.conversationId, CONVERSATION_ID_MAX_CHARS);
      if (!conversationId) {
        return reply.status(400).send({ error: "INVALID_CONVERSATION_ID" });
      }

      const { subjectId } = getAuthenticatedSubject(request);
      const conversation = await options.conversationStore.getOwned(conversationId, subjectId);
      if (!conversation) return reply.status(404).send({ error: "CONVERSATION_NOT_FOUND" });

      const [messages, runIds, knowledge, references, recommendations] = await Promise.all([
        options.userMessageStore.listByConversation(conversationId),
        options.runIndexStore.listRunIds(conversationId),
        options.knowledgeStore?.listKnowledgeByConversation(conversationId) ?? Promise.resolve([]),
        options.knowledgeStore?.listReferences(conversationId) ?? Promise.resolve([]),
        options.recommendationStore?.listRecommendationsByConversation(conversationId) ?? Promise.resolve([]),
      ]);

      const runs = await Promise.all(runIds.map(async (runId) => {
        const run = await options.runStore.get(runId);
        if (!run || run.conversationId !== conversationId) return undefined;
        const decisionPlan = await options.decisionPlanStore.getByRunId(runId);
        return {
          runId: run.id,
          status: run.status,
          version: run.version,
          eventCount: run.events.length,
          outcomeAvailable: run.status === "COMPLETED" && (
            isConsultationRunRequest(run.request)
              ? true
              : run.decision !== null && run.explanation !== null
          ),
          exactBinding: decisionPlan !== undefined
            ? {
              decisionPlanId: decisionPlan.decisionPlanId,
              intentScopeId: decisionPlan.intentScopeId,
              intentVersionId: decisionPlan.intentVersionId,
            }
            : isConsultationRunRequest(run.request)
              && run.request.intentScopeId
              && run.request.intentVersionId
              ? {
                decisionPlanId: null,
                intentScopeId: run.request.intentScopeId,
                intentVersionId: run.request.intentVersionId,
              }
              : null,
          links: {
            run: `/api/v1/runs/${encodeURIComponent(run.id)}`,
            events: `/api/v1/runs/${encodeURIComponent(run.id)}/events`,
            eventStream: `/api/v1/runs/${encodeURIComponent(run.id)}/events/stream`,
            outcome: `/api/v1/runs/${encodeURIComponent(run.id)}/outcome`,
            decisionPlan: `/api/v1/runs/${encodeURIComponent(run.id)}/decision-plan`,
          },
        };
      }));

      return reply.status(200).send({
        conversation,
        messages: messages.map((message) => ({
          id: message.messageId,
          role: "USER" as const,
          content: message.content,
          createdAt: message.createdAt,
        })),
        runs: runs.filter((run) => run !== undefined),
        knowledge: knowledge.map((record) => ({
          knowledgeId: record.knowledgeId,
          runId: record.runId,
          intentVersionId: record.intentVersionId,
          objective: record.objective,
          claimIds: record.claimIds,
          sourceIds: record.sourceIds,
          evidenceIds: record.evidenceIds,
          truthAssessmentIds: record.truthAssessmentIds,
          asOf: record.asOf,
          createdAt: record.createdAt,
          link: `/api/v1/knowledge/${encodeURIComponent(record.knowledgeId)}`,
        })),
        references: references.map((reference) => ({
          referenceId: reference.referenceId,
          userMessageId: reference.userMessageId,
          responseId: reference.responseId,
          intentVersionId: reference.intentVersionId,
          knowledgeId: reference.knowledgeId,
          referenceKind: reference.referenceKind,
          parentReferenceId: reference.parentReferenceId,
          createdAt: reference.createdAt,
        })),
        recommendations: recommendations.map((record) => ({
          recommendationId: record.recommendationId,
          runId: record.runId,
          intentVersionId: record.intentVersionId,
          sourceMessageId: record.sourceMessageId,
          basis: record.basis,
          knowledgeIds: record.knowledgeIds,
          claimIds: record.claimIds,
          recommendation: record.recommendation,
          rationale: record.rationale,
          tradeoffs: record.tradeoffs,
          assumptions: record.assumptions,
          uncertainties: record.uncertainties,
          alternatives: record.alternatives,
          selectionAuthorized: record.selectionAuthorized,
          createdAt: record.createdAt,
          link: `/api/v1/recommendations/${encodeURIComponent(record.recommendationId)}`,
        })),
      });
    },
  );

  app.get<{
    Params: { conversationId: string };
    Querystring: { knownRevision?: string };
  }>(
    "/api/v1/conversations/:conversationId/presentation",
    async (request, reply) => {
      const conversationId = validBoundedId(request.params.conversationId, CONVERSATION_ID_MAX_CHARS);
      if (!conversationId) return reply.status(400).send({ error: "INVALID_CONVERSATION_ID" });
      const knownRevision = request.query.knownRevision === undefined
        ? undefined
        : validBoundedId(request.query.knownRevision, PRESENTATION_REVISION_MAX_CHARS);
      if (request.query.knownRevision !== undefined && !knownRevision) {
        return reply.status(400).send({ error: "INVALID_PRESENTATION_REVISION" });
      }

      const { subjectId } = getAuthenticatedSubject(request);
      const conversation = await options.conversationStore.getOwned(conversationId, subjectId);
      if (!conversation) return reply.status(404).send({ error: "CONVERSATION_NOT_FOUND" });

      const { run, decisionPlan, intentVersion, outcome } = await readLatestPresentationBasis(conversationId, options);
      const snapshot = composeSolandraPresentation({
        conversationId,
        ...(run ? { run } : {}),
        ...(decisionPlan ? { decisionPlan } : {}),
        ...(intentVersion ? { intentVersion } : {}),
        ...(outcome ? { outcome } : {}),
        ...(knownRevision ? { knownRevision } : {}),
      });
      return reply.status(200).send({ presentation: snapshot });
    },
  );

  app.get<{
    Params: { conversationId: string; resourceId: string };
    Querystring: { presentationRevision?: string };
  }>(
    "/api/v1/conversations/:conversationId/presentation/resources/:resourceId",
    async (request, reply) => {
      const conversationId = validBoundedId(request.params.conversationId, CONVERSATION_ID_MAX_CHARS);
      const resourceId = validBoundedId(request.params.resourceId, RESOURCE_ID_MAX_CHARS);
      const expectedRevision = request.query.presentationRevision === undefined
        ? undefined
        : validBoundedId(request.query.presentationRevision, PRESENTATION_REVISION_MAX_CHARS);
      if (!conversationId) return reply.status(400).send({ error: "INVALID_CONVERSATION_ID" });
      if (!resourceId) return reply.status(400).send({ error: "INVALID_RESOURCE_ID" });
      if (!expectedRevision) return reply.status(400).send({ error: "PRESENTATION_REVISION_REQUIRED" });

      const { subjectId } = getAuthenticatedSubject(request);
      const conversation = await options.conversationStore.getOwned(conversationId, subjectId);
      if (!conversation) return reply.status(404).send({ error: "CONVERSATION_NOT_FOUND" });

      const { run, decisionPlan, intentVersion, outcome } = await readLatestPresentationBasis(conversationId, options);
      const snapshot = composeSolandraPresentation({
        conversationId,
        ...(run ? { run } : {}),
        ...(decisionPlan ? { decisionPlan } : {}),
        ...(intentVersion ? { intentVersion } : {}),
        ...(outcome ? { outcome } : {}),
      });
      if (snapshot.presentationRevision !== expectedRevision) {
        return reply.status(409).send({
          error: "PRESENTATION_STALE",
          presentationRevision: snapshot.presentationRevision,
        });
      }

      const resource = hydrateSolandraResource({
        snapshot,
        resourceId,
        ...(run ? { run } : {}),
        ...(decisionPlan ? { decisionPlan } : {}),
        ...(outcome ? { outcome } : {}),
      });
      if (!resource) return reply.status(404).send({ error: "RESOURCE_NOT_FOUND" });
      return reply.status(200).send({ resource });
    },
  );
}
