import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { createApiRequestHash, type ApiRunControlStore } from "./api-control-store.js";
import { consultationRunRequestSchema } from "./domain.js";
import type { IntentUserMessageStore } from "./intent/source-message-store.js";
import { buildRunOutcome } from "./outcome.js";
import { createPendingRun } from "./run-execution.js";
import type { RunStore } from "./run-store.js";

const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1_000;

const consultationTurnSchema = z.object({
  turnId: z.string().min(1).max(200),
  message: z.string().min(1).max(8_000).refine((value) => value.trim().length > 0, "message must not be blank"),
  context: z.array(z.string().min(1).max(4_000)).max(32).optional(),
  prepare: z.enum(["CHECKLIST", "PREPARED_MESSAGE"]).optional(),
}).strict();

export interface ConsultationIntakeOptions {
  userMessageStore: IntentUserMessageStore;
  apiControlStore: ApiRunControlStore;
  runStore: RunStore;
  apiSubject?: string | ((request: FastifyRequest) => string);
}

function digestHex(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\u001f")).digest("hex");
}

function stableUuid(...parts: string[]): `${string}-${string}-${string}-${string}-${string}` {
  const digest = digestHex(...parts).slice(0, 32);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
}

export function registerConsultationIntake(app: FastifyInstance, options: ConsultationIntakeOptions): void {
  const configuredApiSubject = options.apiSubject;
  const apiSubjectForRequest = typeof configuredApiSubject === "function"
    ? configuredApiSubject
    : () => configuredApiSubject ?? "fixture-user";

  app.post<{ Params: { conversationId: string } }>(
    "/api/v1/conversations/:conversationId/turns",
    async (request, reply) => {
      const parsed = consultationTurnSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "INVALID_CONSULTATION_TURN", details: parsed.error.flatten() });
      }
      const conversationId = request.params.conversationId.trim();
      if (!conversationId || conversationId.length > 128) {
        return reply.status(400).send({ error: "INVALID_CONVERSATION_ID" });
      }

      const intentScopeId = `consultation:${conversationId}`;
      const messageId = stableUuid("consultation-message", conversationId, parsed.data.turnId);
      const existing = await options.userMessageStore.get(messageId);
      const history = existing ? [] : await options.userMessageStore.listByConversation(conversationId);
      const messageHorizon = existing?.messageHorizon
        ?? Math.max(0, ...history.map((message) => message.messageHorizon)) + 1;

      let sourceMessage;
      try {
        sourceMessage = await options.userMessageStore.append({
          conversationId,
          intentScopeId,
          logicalUserTurnId: parsed.data.turnId,
          messageId,
          messageHorizon,
          content: parsed.data.message,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "USER message provenance conflict.";
        return reply.status(409).send({ error: "USER_MESSAGE_PROVENANCE_CONFLICT", message });
      }

      const requestBody = consultationRunRequestSchema.parse({
        kind: "consultation",
        objective: sourceMessage.content,
        context: parsed.data.context ?? [],
        decisionNeed: "NONE",
        resourceNeed: parsed.data.prepare ?? "NONE",
        sourceMessageId: sourceMessage.messageId,
        sourceMessageDigest: sourceMessage.contentDigest,
        intentVersion: sourceMessage.messageHorizon,
      });
      const runId = stableUuid(
        "consultation-run",
        conversationId,
        sourceMessage.messageId,
        sourceMessage.contentDigest,
      );
      const run = createPendingRun(conversationId, requestBody, runId);
      const canonicalRoute = `/api/v1/conversations/${encodeURIComponent(conversationId)}/turns`;
      const submission = await options.apiControlStore.submitRun({
        run,
        dispatch: {
          logicalKey: `run:${run.id}:execute`,
          queueName: "lattice.run",
          payload: { runId: run.id, submittedVersion: run.version },
        },
        idempotency: {
          scopeKey: apiSubjectForRequest(request),
          httpMethod: "POST",
          canonicalRoute,
          idempotencyKey: `consultation:${sourceMessage.logicalUserTurnId}`,
          requestHash: createApiRequestHash({
            messageId: sourceMessage.messageId,
            contentDigest: sourceMessage.contentDigest,
            context: requestBody.context,
            resourceNeed: requestBody.resourceNeed,
          }),
          expiresAt: new Date(Date.now() + IDEMPOTENCY_RETENTION_MS),
        },
      });
      if (submission.outcome === "conflict") {
        return reply.status(409).send({ error: "CONSULTATION_IDEMPOTENCY_CONFLICT" });
      }
      return reply.status(202).send({
        status: "RUN_ACCEPTED",
        runId: submission.response.runId,
        acceptedUnderstanding: requestBody.objective,
        provenance: {
          origin: sourceMessage.origin,
          messageId: sourceMessage.messageId,
          contentDigest: sourceMessage.contentDigest,
          intentVersion: requestBody.intentVersion,
        },
      });
    },
  );

  app.get<{ Params: { runId: string } }>("/api/v1/runs/:runId/outcome", async (request, reply) => {
    const run = await options.runStore.get(request.params.runId);
    if (!run) return reply.status(404).send({ error: "RUN_NOT_FOUND" });
    if (run.status === "FAILED" || run.status === "CANCELLED") {
      return reply.status(409).send({ error: "RUN_NOT_SUCCESSFUL", status: run.status });
    }
    if (run.status !== "COMPLETED") {
      return reply.status(202).send({ status: run.status });
    }
    const truth = await options.runStore.getTruthBundle(run.id);
    if (!truth) return reply.status(409).send({ error: "VALIDATED_TRUTH_NOT_AVAILABLE" });
    return reply.send({ runId: run.id, status: run.status, outcome: buildRunOutcome(run, truth) });
  });
}
