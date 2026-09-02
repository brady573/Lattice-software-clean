import type { FastifyInstance } from "fastify";
import type { IntentUserMessageStore } from "../intent/source-message-store.js";

const CONVERSATION_ID_MAX_CHARS = 128;

export interface DurableUserMessageHistoryOptions {
  userMessageStore: IntentUserMessageStore;
}

export function registerDurableUserMessageHistory(
  app: FastifyInstance,
  options: DurableUserMessageHistoryOptions,
): void {
  app.get<{ Params: { conversationId: string } }>(
    "/api/v1/conversations/:conversationId/messages",
    async (request, reply) => {
      const conversationId = request.params.conversationId.trim();
      if (!conversationId || conversationId.length > CONVERSATION_ID_MAX_CHARS) {
        return reply.status(400).send({ error: "INVALID_CONVERSATION_ID" });
      }

      const messages = await options.userMessageStore.listByConversation(conversationId);
      return reply.status(200).send({
        messages: messages.map((message) => ({
          id: message.messageId,
          conversationId: message.conversationId,
          role: "USER" as const,
          content: message.content,
          createdAt: message.createdAt,
        })),
      });
    },
  );
}