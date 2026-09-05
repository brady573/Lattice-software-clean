import type { FastifyInstance } from "fastify";
import { createHttpCore, type HttpCoreOptions } from "./http-core.js";
import type { KnowledgeOutcome } from "./outcome.js";
import { renderKnowledgeResponse } from "./presentation/solandra/knowledge-response.js";
import { renderSolandraAuthoritativeConversationPage } from "./ui/solandra-authoritative-conversation-page.js";

export type CanonicalAppOptions = HttpCoreOptions;

function withKnowledgePresentation(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const envelope = payload as { outcome?: unknown };
  if (!envelope.outcome || typeof envelope.outcome !== "object") return payload;
  const outcome = envelope.outcome as { kind?: unknown };
  if (outcome.kind !== "KNOWLEDGE") return payload;

  return {
    ...envelope,
    presentation: {
      assistantMessage: renderKnowledgeResponse(outcome as KnowledgeOutcome),
    },
  };
}

/**
 * Canonical Product HTTP composition. Legacy structured intake and simulated
 * prototype routes are intentionally unavailable here.
 */
export function buildCanonicalApp(options: CanonicalAppOptions = {}): FastifyInstance {
  const { app } = createHttpCore(options);
  app.addHook("preSerialization", async (request, _reply, payload) => {
    if (request.routeOptions.url !== "/api/v1/runs/:runId/outcome") return payload;
    return withKnowledgePresentation(payload);
  });
  app.get("/", async (_request, reply) =>
    reply.type("text/html; charset=utf-8").send(renderSolandraAuthoritativeConversationPage())
  );
  return app;
}
