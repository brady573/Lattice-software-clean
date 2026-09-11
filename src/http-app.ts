import type { FastifyInstance } from "fastify";
import { createHttpCore, type HttpCoreOptions } from "./http-core.js";
import { renderSolandraAuthoritativeConversationPage } from "./ui/solandra-authoritative-conversation-page.js";

export type CanonicalAppOptions = HttpCoreOptions;

/**
 * Canonical Product HTTP composition. Legacy structured intake and simulated
 * prototype routes are intentionally unavailable here.
 */
export function buildCanonicalApp(options: CanonicalAppOptions = {}): FastifyInstance {
  const { app } = createHttpCore(options);
  app.get("/", async (_request, reply) =>
    reply.type("text/html; charset=utf-8").send(renderSolandraAuthoritativeConversationPage())
  );
  return app;
}
