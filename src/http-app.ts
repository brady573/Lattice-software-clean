import type { FastifyInstance } from "fastify";
import { createHttpCore, type HttpCoreOptions } from "./http-core.js";
import type { ModelAssistanceCapabilityService } from "./model-assistance-capability.js";
import { buildRunOutcome } from "./outcome.js";
import type { KnowledgeSimplifier } from "./presentation/solandra/knowledge-simplification.js";
import { renderKnowledgeResponseForRun } from "./presentation/solandra/knowledge-response.js";
import { renderSolandraAuthoritativeConversationPage } from "./ui/solandra-authoritative-conversation-page.js";

export interface CanonicalAppOptions extends HttpCoreOptions {
  /** Compatibility-only direct simplifier for explicit test/non-canonical compositions. */
  knowledgeSimplifier?: KnowledgeSimplifier | undefined;
  /** Canonical subject-authorized model assistance boundary. */
  modelAssistanceService?: ModelAssistanceCapabilityService | undefined;
}

function hasAssistantPresentation(payload: unknown): boolean {
  if (payload === null || typeof payload !== "object" || !("presentation" in payload)) return false;
  const presentation = payload.presentation;
  if (presentation === null || typeof presentation !== "object" || !("assistantMessage" in presentation)) {
    return false;
  }
  return typeof presentation.assistantMessage === "string" && presentation.assistantMessage.trim().length > 0;
}

/**
 * Canonical Product HTTP composition. Legacy structured intake and simulated
 * prototype routes are intentionally unavailable here.
 */
export function buildCanonicalApp(options: CanonicalAppOptions = {}): FastifyInstance {
  const { knowledgeSimplifier, modelAssistanceService, ...coreOptions } = options;
  const { app, runStore, apiSubjectForRequest } = createHttpCore(coreOptions);
  app.addHook("preSerialization", async (request, _reply, payload) => {
    if (request.routeOptions.url !== "/api/v1/runs/:runId/outcome") return payload;
    if (hasAssistantPresentation(payload)) return payload;

    const runId = (request.params as { runId?: string }).runId;
    if (runId === undefined) return payload;
    const run = await runStore.get(runId);
    if (run?.status !== "COMPLETED") return payload;
    const truth = await runStore.getTruthBundle(run.id);
    if (truth === undefined) return payload;

    const canonicalOutcome = buildRunOutcome(run, truth);
    if (canonicalOutcome.kind !== "KNOWLEDGE") return payload;

    const simplifier = modelAssistanceService === undefined
      ? knowledgeSimplifier
      : modelAssistanceService.simplifierFor(apiSubjectForRequest(request));
    const assistantMessage = await renderKnowledgeResponseForRun(canonicalOutcome, run, simplifier);
    if (payload === null || typeof payload !== "object") return payload;
    return {
      ...payload,
      presentation: { assistantMessage },
    };
  });
  app.get("/", async (_request, reply) =>
    reply.type("text/html; charset=utf-8").send(renderSolandraAuthoritativeConversationPage())
  );
  return app;
}
