import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { getAuthenticatedSubject } from "../auth/authenticated-subject.js";
import type { RunStore } from "../run-store.js";
import { registerConversationMembershipGuard } from "./conversation-membership-guard.js";
import type { ConversationStore } from "./conversation-store.js";

const CONVERSATION_ID_MAX_CHARS = 128;

export interface ConversationApiOptions {
  conversationStore: ConversationStore;
  runStore?: RunStore;
}

function validConversationId(value: string): string | undefined {
  const normalized = value.trim();
  if (!normalized || normalized.length > CONVERSATION_ID_MAX_CHARS) return undefined;
  return normalized;
}

export function registerConversationApi(app: FastifyInstance, options: ConversationApiOptions): void {
  registerConversationMembershipGuard(app, options);

  app.post("/api/v1/conversations", async (request, reply) => {
    const { subjectId } = getAuthenticatedSubject(request);
    const conversation = await options.conversationStore.create(randomUUID(), subjectId);
    return reply.status(201).send({ conversation });
  });

  app.get<{ Params: { conversationId: string } }>(
    "/api/v1/conversations/:conversationId",
    async (request, reply) => {
      const conversationId = validConversationId(request.params.conversationId);
      if (!conversationId) {
        return reply.status(400).send({ error: "INVALID_CONVERSATION_ID" });
      }
      const { subjectId } = getAuthenticatedSubject(request);
      const conversation = await options.conversationStore.getOwned(conversationId, subjectId);
      if (!conversation) return reply.status(404).send({ error: "CONVERSATION_NOT_FOUND" });
      return reply.status(200).send({ conversation });
    },
  );

  app.delete<{ Params: { conversationId: string } }>(
    "/api/v1/conversations/:conversationId",
    async (request, reply) => {
      const conversationId = validConversationId(request.params.conversationId);
      if (!conversationId) {
        return reply.status(400).send({ error: "INVALID_CONVERSATION_ID" });
      }
      const { subjectId } = getAuthenticatedSubject(request);
      const deleted = await options.conversationStore.deleteOwned(conversationId, subjectId);
      if (!deleted) return reply.status(404).send({ error: "CONVERSATION_NOT_FOUND" });
      return reply.status(204).send();
    },
  );
}
