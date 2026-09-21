import type { FastifyInstance } from "fastify";
import { createHttpCore, type HttpCoreOptions } from "./http-core.js";
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
 * Historical Knowledge transformations are handled only through exact
 * ConversationReference resolution in consultation intake. Run-outcome
 * serialization never invokes predecessor Model assistance.
 */
export function buildCanonicalApp(options: CanonicalAppOptions = {}): FastifyInstance {
  const { validatorDeployment = false, ...coreOptions } = options;
  const { app } = createHttpCore(coreOptions);
  app.get("/", async (_request, reply) =>
    reply.type("text/html; charset=utf-8").send(renderCanonicalConversationPage(validatorDeployment))
  );
  return app;
}
