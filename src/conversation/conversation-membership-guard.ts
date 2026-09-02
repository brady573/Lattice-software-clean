import type { FastifyInstance } from "fastify";
import { getAuthenticatedSubject } from "../auth/authenticated-subject.js";
import type { RunStore } from "../run-store.js";
import type { ConversationStore } from "./conversation-store.js";

export interface ConversationMembershipGuardOptions {
  conversationStore: ConversationStore;
  runStore?: RunStore;
}

const CONVERSATION_ID_MAX_CHARS = 128;
const RUN_ID_MAX_CHARS = 200;

function requestPath(url: string): string {
  return url.split("?", 1)[0] ?? url;
}

function runNotFoundError(path: string): { error: string } {
  return path.endsWith("/decision-plan")
    ? { error: "DECISION_PLAN_NOT_FOUND" }
    : { error: "RUN_NOT_FOUND" };
}

/**
 * Enforce Conversation-rooted ownership for authoritative M8 graph access.
 * Child rows retain their existing schemas; authorization is derived through
 * the anchoring Conversation rather than copied into independently mutable
 * ownership fields.
 */
export function registerConversationMembershipGuard(
  app: FastifyInstance,
  options: ConversationMembershipGuardOptions,
): void {
  app.addHook("preHandler", async (request, reply) => {
    const path = requestPath(request.url);

    if (path.startsWith("/api/v1/conversations/")) {
      const { subjectId } = getAuthenticatedSubject(request);
      const params = request.params as { conversationId?: string };
      const conversationId = params.conversationId?.trim();
      if (!conversationId || conversationId.length > CONVERSATION_ID_MAX_CHARS) {
        return reply.status(400).send({ error: "INVALID_CONVERSATION_ID" });
      }

      const conversation = await options.conversationStore.getOwned(conversationId, subjectId);
      if (!conversation) {
        return reply.status(404).send({ error: "CONVERSATION_NOT_FOUND" });
      }
      return;
    }

    if (options.runStore !== undefined && path.startsWith("/api/v1/runs/")) {
      const { subjectId } = getAuthenticatedSubject(request);
      const params = request.params as { runId?: string };
      const runId = params.runId?.trim();
      const notFound = runNotFoundError(path);
      if (!runId || runId.length > RUN_ID_MAX_CHARS) {
        return reply.status(404).send(notFound);
      }

      const run = await options.runStore.get(runId);
      if (!run) return reply.status(404).send(notFound);

      const conversation = await options.conversationStore.getOwned(run.conversationId, subjectId);
      if (!conversation) return reply.status(404).send(notFound);
    }
  });
}
