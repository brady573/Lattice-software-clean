import type { FastifyInstance } from "fastify";
import type { LatticeRun } from "./domain.js";
import { createHttpCore, type HttpCoreOptions } from "./http-core.js";
import type { KnowledgeOutcome } from "./outcome.js";
import type { KnowledgeSimplifier } from "./presentation/solandra/knowledge-simplification.js";
import {
  renderKnowledgeResponse,
  renderKnowledgeResponseForRun,
} from "./presentation/solandra/knowledge-response.js";
import { renderSolandraAuthoritativeConversationPage } from "./ui/solandra-authoritative-conversation-page.js";

export interface CanonicalAppOptions extends HttpCoreOptions {
  knowledgeSimplifier?: KnowledgeSimplifier;
}

async function withKnowledgePresentation(
  payload: unknown,
  run: LatticeRun | undefined,
  simplifier: KnowledgeSimplifier | undefined,
): Promise<unknown> {
  if (!payload || typeof payload !== "object") return payload;
  const envelope = payload as { outcome?: unknown };
  if (!envelope.outcome || typeof envelope.outcome !== "object") return payload;
  const outcome = envelope.outcome as { kind?: unknown };
  if (outcome.kind !== "KNOWLEDGE") return payload;

  const knowledge = outcome as KnowledgeOutcome;
  const assistantMessage = run
    ? await renderKnowledgeResponseForRun(knowledge, run, simplifier)
    : renderKnowledgeResponse(knowledge);

  return {
    ...envelope,
    presentation: { assistantMessage },
  };
}

/**
 * Canonical Product HTTP composition. Legacy structured intake and simulated
 * prototype routes are intentionally unavailable here.
 */
export function buildCanonicalApp(options: CanonicalAppOptions = {}): FastifyInstance {
  const { knowledgeSimplifier, ...coreOptions } = options;
  const { app, runStore } = createHttpCore(coreOptions);
  app.addHook("preSerialization", async (request, _reply, payload) => {
    if (request.routeOptions.url !== "/api/v1/runs/:runId/outcome") return payload;
    const runId = (request.params as { runId?: string }).runId;
    const run = runId === undefined ? undefined : await runStore.get(runId);
    return await withKnowledgePresentation(payload, run, knowledgeSimplifier);
  });
  app.get("/", async (_request, reply) =>
    reply.type("text/html; charset=utf-8").send(renderSolandraAuthoritativeConversationPage())
  );
  return app;
}
