import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createApiRequestHash } from "../api-control-store.js";
import { runRequestSchema } from "../domain.js";
import { createHttpCore, type HttpCoreOptions } from "../http-core.js";
import { createPendingRun, executePersistedRun, RunExecutionError } from "../run-execution.js";
import { renderSolandraAuthoritativeConversationPage } from "../ui/solandra-authoritative-conversation-page.js";

const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000;

function readIdempotencyKey(headers: Record<string, unknown>): string | undefined {
  const raw = headers["idempotency-key"];
  if (raw === undefined) return undefined;
  const value = Array.isArray(raw) ? String(raw[0] ?? "") : String(raw);
  return value.trim();
}

type LegacyStructuredParams = {
  conversationId: string;
  intentScopeId?: string;
  intentVersionId?: string;
};

/**
 * Explicit compatibility composition for historical adapter tests only.
 * Nothing in canonical RuntimeApp imports this module.
 */
export function buildLegacyTestApp(options: HttpCoreOptions = {}): FastifyInstance {
  const {
    app,
    runStore,
    truthPipeline,
    decisionEvidenceProvider,
    apiControlStore,
    apiSubjectForRequest,
  } = createHttpCore(options);
  app.get("/", async (_request, reply) =>
    reply.type("text/html; charset=utf-8").send(renderSolandraAuthoritativeConversationPage())
  );
  app.post("/runs", async (request, reply) => {
    const parsed = runRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "INVALID_RUN_REQUEST", details: parsed.error.flatten() });
    }
    const run = createPendingRun("legacy", parsed.data);
    try {
      await runStore.create(run);
      return reply.status(201).send(await executePersistedRun(
        runStore,
        truthPipeline,
        run.id,
        undefined,
        undefined,
        decisionEvidenceProvider,
      ));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown decision error";
      const runId = error instanceof RunExecutionError ? error.runId : run.id;
      return reply.status(422).send({ error: "NO_VALID_DECISION", message, runId });
    }
  });

  const submitLegacyStructuredRun = async (
    request: FastifyRequest<{ Params: LegacyStructuredParams }>,
    reply: FastifyReply,
  ) => {
    const parsed = runRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "INVALID_RUN_REQUEST", details: parsed.error.flatten() });
    }
    if (!apiControlStore) return reply.status(503).send({ error: "ASYNC_CONTROL_NOT_CONFIGURED" });
    const idempotencyKey = readIdempotencyKey(request.headers as Record<string, unknown>);
    if (idempotencyKey !== undefined && (idempotencyKey.length === 0 || idempotencyKey.length > 200)) {
      return reply.status(400).send({ error: "INVALID_IDEMPOTENCY_KEY" });
    }
    const run = createPendingRun(request.params.conversationId, parsed.data);
    const exactBinding = request.params.intentScopeId && request.params.intentVersionId
      ? { intentScopeId: request.params.intentScopeId, intentVersionId: request.params.intentVersionId }
      : undefined;
    const canonicalRoute = exactBinding
      ? `/api/v1/conversations/${encodeURIComponent(request.params.conversationId)}/intent-scopes/${encodeURIComponent(exactBinding.intentScopeId)}/versions/${encodeURIComponent(exactBinding.intentVersionId)}/runs`
      : `/api/v1/conversations/${encodeURIComponent(request.params.conversationId)}/messages`;
    try {
      const submission = await apiControlStore.submitRun({
        run,
        ...(exactBinding ? { intentBinding: exactBinding } : {}),
        dispatch: { logicalKey: `run:${run.id}:execute`, queueName: "lattice.run", payload: { runId: run.id, submittedVersion: run.version } },
        ...(idempotencyKey === undefined ? {} : {
          idempotency: {
            scopeKey: apiSubjectForRequest(request),
            httpMethod: "POST",
            canonicalRoute,
            idempotencyKey,
            requestHash: createApiRequestHash(request.body),
            expiresAt: new Date(Date.now() + IDEMPOTENCY_RETENTION_MS),
          },
        }),
      });
      if (submission.outcome === "conflict") {
        return reply.status(409).send({ error: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BODY" });
      }
      return reply.status(202).send(submission.response);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Exact IntentVersion-bound Run intake failed.";
      return reply.status(422).send({ error: "INTENT_BOUND_RUN_REJECTED", message });
    }
  };

  app.post<{ Params: { conversationId: string } }>(
    "/api/v1/conversations/:conversationId/messages",
    submitLegacyStructuredRun,
  );
  app.post<{ Params: { conversationId: string; intentScopeId: string; intentVersionId: string } }>(
    "/api/v1/conversations/:conversationId/intent-scopes/:intentScopeId/versions/:intentVersionId/runs",
    submitLegacyStructuredRun,
  );
  app.get<{ Params: { id: string } }>("/runs/:id", async (request, reply) => {
    const run = await runStore.get(request.params.id);
    return run ?? reply.status(404).send({ error: "RUN_NOT_FOUND" });
  });
  app.get<{ Params: { runId: string } }>("/api/v1/runs/:runId/result", async (request, reply) => {
    const run = await runStore.get(request.params.runId);
    if (!run) return reply.status(404).send({ error: "RUN_NOT_FOUND" });
    if (run.status !== "COMPLETED" || !run.decision || !run.explanation) {
      return reply.status(409).send({ error: "RUN_NOT_COMPLETED", status: run.status });
    }
    return { runId: run.id, status: run.status, decision: run.decision, explanation: run.explanation };
  });

  return app;
}
