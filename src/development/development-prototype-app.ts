import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createHttpCore, type HttpCoreOptions } from "../http-core.js";
import type { ModelRuntime } from "../model/index.js";
import { renderSolandraConversationPrototypePage } from "../ui/solandra-conversation-prototype-page.js";
import { renderSolandraPrototypePage } from "../ui/solandra-prototype-page.js";

const MESSAGE_MAX_CHARS = 4_000;
const TRANSCRIPT_MAX_MESSAGES = 24;
const MODEL_SYSTEM_PROMPT = [
  "You are participating in the Lattice offline conversation prototype.",
  "Respond conversationally to help exercise interaction behavior.",
  "Your output is simulation material only: do not claim that facts are verified, do not claim that a Lattice decision has been made, and do not imply that your text entered V36 or StructuredDecision.",
  "If the user asks for an authoritative recommendation, explain that the authoritative decision path is separate from this simulated conversation.",
].join(" ");

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(MESSAGE_MAX_CHARS).refine(
    (value) => value.trim().length > 0,
    "Message content must contain non-whitespace text.",
  ),
});
const requestSchema = z.object({
  turnId: z.string().min(1).max(200).refine(
    (value) => value.trim().length > 0,
    "turnId must contain non-whitespace text.",
  ),
  messages: z.array(messageSchema).min(1).max(TRANSCRIPT_MAX_MESSAGES),
}).refine(
  (value) => value.messages.at(-1)?.role === "user",
  { message: "The latest simulated conversation message must be from the user.", path: ["messages"] },
);

export type DevelopmentPrototypeAppOptions = HttpCoreOptions & {
  modelRuntime?: ModelRuntime;
  modelName?: string;
};

export type DevelopmentModelConversationOptions = {
  modelRuntime?: ModelRuntime;
  modelName?: string;
};

/** Registers only the simulated model-conversation endpoint on an explicit development app. */
export function registerDevelopmentModelConversationPrototype(
  app: FastifyInstance,
  options: DevelopmentModelConversationOptions,
): void {
  const modelRuntime = options.modelRuntime;
  const modelName = options.modelName ?? "offline-prototype";
  app.post<{ Params: { conversationId: string } }>(
    "/api/v1/prototype/model-conversations/:conversationId/messages",
    async (request, reply) => {
      if (modelRuntime === undefined) {
        return reply.status(503).send({
          error: "MODEL_SIMULATION_NOT_CONFIGURED",
          message: "The offline conversation simulator is not configured for this Lattice process.",
        });
      }
      const conversationId = request.params.conversationId.trim();
      if (conversationId.length === 0 || conversationId.length > 128) {
        return reply.status(400).send({ error: "INVALID_PROTOTYPE_CONVERSATION_ID" });
      }
      const parsed = requestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "INVALID_PROTOTYPE_CONVERSATION", details: parsed.error.flatten() });
      }
      try {
        const result = await modelRuntime.call({
          model: modelName,
          messages: [{ role: "system", content: MODEL_SYSTEM_PROMPT }, ...parsed.data.messages],
          temperature: 0,
          maxOutputTokens: 768,
        }, {
          correlationId: `prototype-conversation:${conversationId}`,
          idempotencyKey: parsed.data.turnId,
          maxAttempts: 2,
        });
        const textOutput = result.response.output.find((item) => item.type === "text");
        if (textOutput?.type !== "text") {
          return reply.status(422).send({
            error: "MODEL_SIMULATION_TEXT_REQUIRED",
            message: "The simulator returned no conversational text for this prototype turn.",
          });
        }
        return reply.status(200).send({
          conversationId,
          turnId: parsed.data.turnId,
          simulated: true,
          message: { role: "assistant", content: textOutput.text },
        });
      } catch {
        return reply.status(503).send({
          error: "MODEL_SIMULATION_UNAVAILABLE",
          message: "The simulated conversation could not produce a response. Check the offline simulator and try again.",
        });
      }
    },
  );
}

/** Explicit non-canonical composition for the disposable conversation simulator. */
export function buildDevelopmentPrototypeApp(
  options: DevelopmentPrototypeAppOptions = {},
): FastifyInstance {
  const { app } = createHttpCore(options);
  const modelRuntime = options.modelRuntime;
  app.get("/", async (_request, reply) => reply.type("text/html; charset=utf-8").send(
    modelRuntime === undefined ? renderSolandraPrototypePage() : renderSolandraConversationPrototypePage(),
  ));
  registerDevelopmentModelConversationPrototype(app, options);
  return app;
}
