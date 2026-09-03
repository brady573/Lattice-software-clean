import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { MemoryApiRunControlStore, type ApiRunControlStore } from "./api-control-store.js";
import { MemoryRunStore, type RunStore } from "./run-store.js";
import { createDefaultOfflineTruthPipeline, type TruthExecutionPipeline } from "./truth/execution-pipeline.js";
import type { DecisionEvidenceProvider } from "./truth/decision-evidence-provider.js";

export type HttpCoreOptions = {
  runStore?: RunStore;
  truthPipeline?: TruthExecutionPipeline;
  decisionEvidenceProvider?: DecisionEvidenceProvider;
  apiControlStore?: ApiRunControlStore;
  /** Fixture subject or request-scoped authenticated subject resolver for API idempotency. */
  apiSubject?: string | ((request: FastifyRequest) => string);
};

export type HttpCore = {
  app: FastifyInstance;
  runStore: RunStore;
  truthPipeline: TruthExecutionPipeline;
  decisionEvidenceProvider: DecisionEvidenceProvider | undefined;
  apiControlStore: ApiRunControlStore | undefined;
  apiSubjectForRequest: (request: FastifyRequest) => string;
};

/**
 * Shared transport substrate. It deliberately contains only health and
 * canonical Run observation/control routes; intake and prototype surfaces
 * belong to explicit higher-level compositions.
 */
export function createHttpCore(options: HttpCoreOptions = {}): HttpCore {
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

  app.addHook("onClose", async () => {
    if (apiControlStore) await apiControlStore.close();
    await runStore.close();
  });

  app.get("/health", async () => ({
    status: "ok",
    mode: runStore.kind === "memory" ? "fixture" : "postgres",
    truth: "v36-offline",
    lifecycle: apiControlStore ? "async-dispatch" : "persisted-transitions",
  }));

  app.post<{ Params: { runId: string } }>("/api/v1/runs/:runId/cancel", async (request, reply) => {
    const current = await runStore.get(request.params.runId);
    if (!current) return reply.status(404).send({ error: "RUN_NOT_FOUND" });
    if (current.status === "CANCELLED") return reply.status(202).send({ runId: current.id, status: current.status });
    if (current.status === "COMPLETED" || current.status === "FAILED") {
      return reply.status(409).send({ error: "RUN_TERMINAL", status: current.status });
    }
    const cancelled = await runStore.transition({
      runId: current.id,
      expectedStatus: current.status,
      expectedVersion: current.version,
      nextStatus: "CANCELLED",
    });
    if (cancelled.outcome === "advanced") return reply.status(202).send({ runId: current.id, status: "CANCELLED" });
    const raced = await runStore.get(current.id);
    if (raced?.status === "CANCELLED") return reply.status(202).send({ runId: raced.id, status: raced.status });
    return reply.status(409).send({ error: "RUN_STATE_CHANGED", status: raced?.status ?? "UNKNOWN" });
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

  return { app, runStore, truthPipeline, decisionEvidenceProvider, apiControlStore, apiSubjectForRequest };
}
