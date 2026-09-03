import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { z } from "zod";
import {
  createApiRequestHash,
  MemoryApiRunControlStore,
  type ApiRunControlStore,
} from "./api-control-store.js";
import { runRequestSchema } from "./domain.js";
import type { ModelRuntime } from "./model/index.js";
import { MemoryRunStore, type RunStore } from "./run-store.js";
import {
  createPendingRun,
  executePersistedRun,
  RunExecutionError,
} from "./run-execution.js";
import {
  createDefaultOfflineTruthPipeline,
  type TruthExecutionPipeline,
} from "./truth/execution-pipeline.js";
import {
  type DecisionEvidenceProvider,
} from "./truth/decision-evidence-provider.js";
import { renderSolandraAuthoritativeConversationPage } from "./ui/solandra-authoritative-conversation-page.js";
import { renderSolandraConversationPrototypePage } from "./ui/solandra-conversation-prototype-page.js";
import { renderSolandraPrototypePage } from "./ui/solandra-prototype-page.js";

const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000;
const PROTOTYPE_MESSAGE_MAX_CHARS = 4_000;
const PROTOTYPE_TRANSCRIPT_MAX_MESSAGES = 24;
const PROTOTYPE_MODEL_SYSTEM_PROMPT = [
  "You are participating in the Lattice offline conversation prototype.",
  "Respond conversationally to help exercise interaction behavior.",
  "Your output is simulation material only: do not claim that facts are verified, do not claim that a Lattice decision has been made, and do not imply that your text entered V36 or StructuredDecision.",
  "If the user asks for an authoritative recommendation, explain that the authoritative decision path is separate from this simulated conversation.",
].join(" ");

const prototypeConversationMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(PROTOTYPE_MESSAGE_MAX_CHARS).refine(
    (value) => value.trim().length > 0,
    "Message content must contain non-whitespace text.",
  ),
});

const prototypeConversationRequestSchema = z.object({
  turnId: z.string().min(1).max(200).refine(
    (value) => value.trim().length > 0,
    "turnId must contain non-whitespace text.",
  ),
  messages: z.array(prototypeConversationMessageSchema).min(1).max(PROTOTYPE_TRANSCRIPT_MAX_MESSAGES),
}).refine(
  (value) => value.messages.at(-1)?.role === "user",
  { message: "The latest simulated conversation message must be from the user.", path: ["messages"] },
);

export type BuildAppOptions = {
  runStore?: RunStore;
  truthPipeline?: TruthExecutionPipeline;
  decisionEvidenceProvider?: DecisionEvidenceProvider;
  apiControlStore?: ApiRunControlStore;
  /** Fixture subject or request-scoped authenticated subject resolver for API idempotency. */
  apiSubject?: string | ((request: FastifyRequest) => string);
  /** Optional development-only model runtime used by the transient conversation simulator. */
  modelRuntime?: ModelRuntime;
  /** Canonical model identifier sent through the provider-neutral runtime. */
  modelName?: string;
  /** Serve the M7 authoritative conversation lifecycle rather than a prototype-only root page. */
  authoritativeConversationUi?: boolean;
};

function readIdempotencyKey(headers: Record<string, unknown>): string | undefined {
  const raw = headers["idempotency-key"];
  if (raw === undefined) return undefined;
  const value = Array.isArray(raw) ? String(raw[0] ?? "") : String(raw);
  return value.trim();
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const runStore = options.runStore ?? new MemoryRunStore();
  const truthPipeline = options.truthPipeline ?? createDefaultOfflineTruthPipeline();
  const decisionEvidenceProvider = options.decisionEvidenceProvider;
  const apiControlStore = options.apiControlStore
    ?? (runStore.kind === "memory" ? new MemoryApiRunControlStore(runStore) : undefined);
  const configuredApiSubject = options.apiSubject;
  const apiSubjectForRequest = typeof configuredApiSubject === "function"
    ? configuredApiSubject
    : () => configuredApiSubject ?? "fixture-user";
  const modelRuntime = options.modelRuntime;
  const modelName = options.modelName ?? "offline-prototype";

  app.addHook("onClose", async () => {
    if (apiControlStore) await apiControlStore.close();
    await runStore.close();
  });

  app.get("/", async (_request, reply) =>
    reply.type("text/html; charset=utf-8").send(
      options.authoritativeConversationUi
        ? renderSolandraAuthoritativeConversationPage()
        : modelRuntime === undefined
          ? renderSolandraPrototypePage()
          : renderSolandraConversationPrototypePage(),
    )
  );

  app.get("/health", async () => ({
    status: "ok",
    mode: runStore.kind === "memory" ? "fixture" : "postgres",
    truth: "v36-offline",
    lifecycle: apiControlStore ? "async-dispatch" : "persisted-transitions",
  }));

  app.post<{ Params: { conversationId: string } }>(
    "/api/v1/prototype/model-conversations/:conversationId/messages",
    async (request, reply) => {
      if (modelRuntime === undefined) {
        return reply.status(503).send({
          error: "MODEL_SIMULATION_NOT_CONFIGURED",
          message: "The offline conversation simulator is not configured for this Lattice process.",
        });
      }

      const conversationId = request.params.conversationId.trim();
      if (conversationId.length === 0 || conversationId.length > 128) {
        return reply.status(400).send({ error: "INVALID_PROTOTYPE_CONVERSATION_ID" });
      }

      const parsed = prototypeConversationRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "INVALID_PROTOTYPE_CONVERSATION",
          details: parsed.error.flatten(),
        });
      }

      try {
        const result = await modelRuntime.call({
          model: modelName,
          messages: [
            { role: "system", content: PROTOTYPE_MODEL_SYSTEM_PROMPT },
            ...parsed.data.messages,
          ],
          temperature: 0,
          maxOutputTokens: 768,
        }, {
          correlationId: `prototype-conversation:${conversationId}`,
          idempotencyKey: parsed.data.turnId,
          maxAttempts: 2,
        });

        const textOutput = result.response.output.find((item) => item.type === "text");
        if (textOutput?.type !== "text") {
          return reply.status(422).send({
            error: "MODEL_SIMULATION_TEXT_REQUIRED",
            message: "The simulator returned no conversational text for this prototype turn.",
          });
        }

        return reply.status(200).send({
          conversationId,
          turnId: parsed.data.turnId,
          simulated: true,
          message: {
            role: "assistant",
            content: textOutput.text,
          },
        });
      } catch {
        return reply.status(503).send({
          error: "MODEL_SIMULATION_UNAVAILABLE",
          message: "The simulated conversation could not produce a response. Check the offline simulator and try again.",
        });
      }
    },
  );

  // Compatibility fixture endpoint. The versioned API below is the durable
  // asynchronous contract; this route remains synchronous for focused tests.
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

  app.post<{ Params: { conversationId: string } }>(
    "/api/v1/conversations/:conversationId/messages",
    async (request, reply) => {
      const parsed = runRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "INVALID_RUN_REQUEST", details: parsed.error.flatten() });
      }
      if (!apiControlStore) {
        return reply.status(503).send({ error: "ASYNC_CONTROL_NOT_CONFIGURED" });
      }

      const idempotencyKey = readIdempotencyKey(request.headers as Record<string, unknown>);
      if (idempotencyKey !== undefined && (idempotencyKey.length === 0 || idempotencyKey.length > 200)) {
        return reply.status(400).send({ error: "INVALID_IDEMPOTENCY_KEY" });
      }

      const run = createPendingRun(request.params.conversationId, parsed.data);
      const canonicalRoute = `/api/v1/conversations/${encodeURIComponent(request.params.conversationId)}/messages`;
      const submission = await apiControlStore.submitRun({
        run,
        dispatch: {
          logicalKey: `run:${run.id}:execute`,
          queueName: "lattice.run",
          payload: { runId: run.id, submittedVersion: run.version },
        },
        ...(idempotencyKey === undefined
          ? {}
          : {
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
    },
  );

  app.post<{
    Params: { conversationId: string; intentScopeId: string; intentVersionId: string };
  }>(
    "/api/v1/conversations/:conversationId/intent-scopes/:intentScopeId/versions/:intentVersionId/runs",
    async (request, reply) => {
      const parsed = runRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "INVALID_RUN_REQUEST", details: parsed.error.flatten() });
      }
      if (!apiControlStore) {
        return reply.status(503).send({ error: "ASYNC_CONTROL_NOT_CONFIGURED" });
      }

      const idempotencyKey = readIdempotencyKey(request.headers as Record<string, unknown>);
      if (idempotencyKey !== undefined && (idempotencyKey.length === 0 || idempotencyKey.length > 200)) {
        return reply.status(400).send({ error: "INVALID_IDEMPOTENCY_KEY" });
      }

      const run = createPendingRun(request.params.conversationId, parsed.data);
      const canonicalRoute = [
        "/api/v1/conversations",
        encodeURIComponent(request.params.conversationId),
        "intent-scopes",
        encodeURIComponent(request.params.intentScopeId),
        "versions",
        encodeURIComponent(request.params.intentVersionId),
        "runs",
      ].join("/");

      try {
        const submission = await apiControlStore.submitRun({
          run,
          intentBinding: {
            intentScopeId: request.params.intentScopeId,
            intentVersionId: request.params.intentVersionId,
          },
          dispatch: {
            logicalKey: `run:${run.id}:execute`,
            queueName: "lattice.run",
            payload: { runId: run.id, submittedVersion: run.version },
          },
          ...(idempotencyKey === undefined
            ? {}
            : {
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
    },
  );

  app.post<{ Params: { runId: string } }>("/api/v1/runs/:runId/cancel", async (request, reply) => {
    const current = await runStore.get(request.params.runId);
    if (!current) return reply.status(404).send({ error: "RUN_NOT_FOUND" });
    if (current.status === "CANCELLED") {
      return reply.status(202).send({ runId: current.id, status: current.status });
    }
    if (current.status === "COMPLETED" || current.status === "FAILED") {
      return reply.status(409).send({ error: "RUN_TERMINAL", status: current.status });
    }
    const cancelled = await runStore.transition({
      runId: current.id,
      expectedStatus: current.status,
      expectedVersion: current.version,
      nextStatus: "CANCELLED",
    });
    if (cancelled.outcome === "advanced") {
      return reply.status(202).send({ runId: current.id, status: "CANCELLED" });
    }
    const raced = await runStore.get(current.id);
    if (raced?.status === "CANCELLED") {
      return reply.status(202).send({ runId: raced.id, status: raced.status });
    }
    return reply.status(409).send({ error: "RUN_STATE_CHANGED", status: raced?.status ?? "UNKNOWN" });
  });

  app.get<{ Params: { id: string } }>("/runs/:id", async (request, reply) => {
    const run = await runStore.get(request.params.id);
    return run ?? reply.status(404).send({ error: "RUN_NOT_FOUND" });
  });

  app.get<{ Params: { runId: string } }>("/api/v1/runs/:runId", async (request, reply) => {
    const run = await runStore.get(request.params.runId);
    return run ?? reply.status(404).send({ error: "RUN_NOT_FOUND" });
  });

  app.get<{ Params: { runId: string } }>("/api/v1/runs/:runId/events", async (request, reply) => {
    const run = await runStore.get(request.params.runId);
    if (!run) return reply.status(404).send({ error: "RUN_NOT_FOUND" });
    return { runId: run.id, events: run.events };
  });

  app.get<{ Params: { runId: string } }>("/api/v1/runs/:runId/result", async (request, reply) => {
    const run = await runStore.get(request.params.runId);
    if (!run) return reply.status(404).send({ error: "RUN_NOT_FOUND" });
    if (run.status !== "COMPLETED" || !run.decision || !run.explanation) {
      return reply.status(409).send({ error: "RUN_NOT_COMPLETED", status: run.status });
    }
    return {
      runId: run.id,
      status: run.status,
      decision: run.decision,
      explanation: run.explanation,
    };
  });

  return app;
}
