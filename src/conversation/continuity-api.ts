import type { FastifyInstance } from "fastify";
import { getAuthenticatedSubject } from "../auth/authenticated-subject.js";
import type { DecisionPlanStore, DurableDecisionPlan } from "../intent/decision-plan-store.js";
import type { IntentUserMessageStore } from "../intent/source-message-store.js";
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
  decisionPlan: DurableDecisionPlan | undefined;
}> {
  const runIds = await options.runIndexStore.listRunIds(conversationId);
  for (let index = runIds.length - 1; index >= 0; index -= 1) {
    const runId = runIds[index];
    if (!runId) continue;
    const run = await options.runStore.get(runId);
    if (!run || run.conversationId !== conversationId) continue;
    const decisionPlan = await options.decisionPlanStore.getByRunId(run.id);
    return { run, decisionPlan };
  }
  return { run: undefined, decisionPlan: undefined };
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

      const [messages, runIds] = await Promise.all([
        options.userMessageStore.listByConversation(conversationId),
        options.runIndexStore.listRunIds(conversationId),
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
          resultAvailable: run.status === "COMPLETED" && run.decision !== null && run.explanation !== null,
          exactBinding: decisionPlan === undefined ? null : {
            decisionPlanId: decisionPlan.decisionPlanId,
            intentScopeId: decisionPlan.intentScopeId,
            intentVersionId: decisionPlan.intentVersionId,
          },
          links: {
            run: `/api/v1/runs/${encodeURIComponent(run.id)}`,
            events: `/api/v1/runs/${encodeURIComponent(run.id)}/events`,
            eventStream: `/api/v1/runs/${encodeURIComponent(run.id)}/events/stream`,
            result: `/api/v1/runs/${encodeURIComponent(run.id)}/result`,
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

      const { run, decisionPlan } = await readLatestPresentationBasis(conversationId, options);
      const snapshot = composeSolandraPresentation({
        conversationId,
        ...(run ? { run } : {}),
        ...(decisionPlan ? { decisionPlan } : {}),
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

      const { run, decisionPlan } = await readLatestPresentationBasis(conversationId, options);
      const snapshot = composeSolandraPresentation({
        conversationId,
        ...(run ? { run } : {}),
        ...(decisionPlan ? { decisionPlan } : {}),
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
      });
      if (!resource) return reply.status(404).send({ error: "RESOURCE_NOT_FOUND" });
      return reply.status(200).send({ resource });
    },
  );
}
