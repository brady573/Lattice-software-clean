import type { FastifyInstance } from "fastify";
import { createHttpCore, type HttpCoreOptions } from "./http-core.js";
import { buildRunOutcome } from "./outcome.js";
import { renderKnowledgeResponseForRun } from "./presentation/solandra/knowledge-response.js";
import { renderSolandraAuthoritativeConversationPage } from "./ui/solandra-authoritative-conversation-page.js";
import { renderSolandraValidatorConversationPage } from "./ui/solandra-validator-conversation-page.js";

/**
 * @internal Lower-level HTTP composition options used by RuntimeApp assembly and
 * deliberately isolated tests. This surface does not install authentication.
 */
export interface CanonicalAppOptions extends HttpCoreOptions {
  /** Deployment/session presentation role already resolved by runtime configuration. */
  validatorDeployment?: boolean;
}

function hasAssistantMessage(payload: unknown): boolean {
  if (payload === null || typeof payload !== "object" || !("presentation" in payload)) return false;
  const presentation = payload.presentation;
  if (presentation === null || typeof presentation !== "object" || !("assistantMessage" in presentation)) {
    return false;
  }
  return typeof presentation.assistantMessage === "string" && presentation.assistantMessage.trim().length > 0;
}

function renderCanonicalConversationPage(validatorDeployment: boolean): string {
  return validatorDeployment
    ? renderSolandraValidatorConversationPage()
    : renderSolandraAuthoritativeConversationPage();
}

/**
 * @internal Lower-level HTTP composition primitive for RuntimeApp assembly and
 * deliberately isolated tests. It intentionally does not install the
 * authenticated-subject boundary; supported Product construction goes through
 * createRuntimeApp(), which owns that authentication boundary.
 *
 * Historical Knowledge transformations are handled through exact
 * ConversationReference resolution in consultation intake. Independently,
 * completed canonical Knowledge outcomes receive their ordinary governed
 * Product-facing presentation here. This path has no assistance authorization
 * or simplification dependency.
 */
export function buildCanonicalApp(options: CanonicalAppOptions = {}): FastifyInstance {
  const { validatorDeployment = false, ...coreOptions } = options;
  const { app, runStore } = createHttpCore(coreOptions);
  app.addHook("preSerialization", async (request, _reply, payload) => {
    if (request.routeOptions.url !== "/api/v1/runs/:runId/outcome") return payload;
    if (hasAssistantMessage(payload)) return payload;

    const runId = (request.params as { runId?: string }).runId;
    if (runId === undefined) return payload;
    const run = await runStore.get(runId);
    if (run?.status !== "COMPLETED") return payload;
    const truth = await runStore.getTruthBundle(run.id);
    if (truth === undefined) return payload;

    const canonicalOutcome = buildRunOutcome(run, truth);
    if (canonicalOutcome.kind !== "KNOWLEDGE") return payload;

    const assistantMessage = await renderKnowledgeResponseForRun(canonicalOutcome, run);
    if (payload === null || typeof payload !== "object") return payload;
    return {
      ...payload,
      presentation: { assistantMessage },
    };
  });
  app.get("/", async (_request, reply) =>
    reply.type("text/html; charset=utf-8").send(renderCanonicalConversationPage(validatorDeployment))
  );
  return app;
}
