import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AndroidRelayModelProvider, ModelRuntime } from "../model/index.js";
import {
  compileSpecialistGuidanceControl,
  loadDefaultPrototypeSpecialistGuidanceRegistry,
  parsePrototypeIntentVersionFixture,
  resolvePrototypeSpecialistGuidance,
  specialistGuidanceAudit,
  type PrototypeIntentVersionFixture,
  type SpecialistGuidanceResolution,
} from "../specialist-guidance/prototype.js";
import { renderSolandraLocalModelPrototypePage } from "../ui/solandra-local-model-prototype-page.js";

const MESSAGE_MAX_CHARS = 4_000;
const TRANSCRIPT_MAX_MESSAGES = 24;
const RELAY_MAX_RESPONSE_CHARS = 512 * 1024;
const LOCAL_MODEL_SYSTEM_PROMPT = [
  "You are participating in the Lattice Android local-model prototype.",
  "Respond conversationally to help exercise interaction behavior.",
  "Your output is prototype model material only: do not claim that facts are verified, do not claim that a Lattice decision has been made, and do not imply that your text entered the V36 Truth Core or Lattice Decision Engine.",
  "If the user asks for an authoritative recommendation, explain that the authoritative Lattice Decision Engine path is separate from this prototype model conversation.",
].join(" ");

const conversationMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(MESSAGE_MAX_CHARS).refine(
    (value) => value.trim().length > 0,
    "Message content must contain non-whitespace text.",
  ),
});

const conversationRequestSchema = z.object({
  turnId: z.string().min(1).max(200).refine(
    (value) => value.trim().length > 0,
    "turnId must contain non-whitespace text.",
  ),
  messages: z.array(conversationMessageSchema).min(1).max(TRANSCRIPT_MAX_MESSAGES),
  prototypeIntentVersion: z.unknown().optional(),
}).refine(
  (value) => value.messages.at(-1)?.role === "user",
  { message: "The latest prototype conversation message must be from the user.", path: ["messages"] },
);

const relayCompletionSchema = z.object({
  statusCode: z.number().int().min(100).max(599),
  bodyText: z.string().max(RELAY_MAX_RESPONSE_CHARS),
});

export interface AndroidModelPrototypeOptions {
  readonly provider: AndroidRelayModelProvider;
  readonly runtime: ModelRuntime;
  readonly modelName: string;
  readonly relayToken: string;
}

function readBearerToken(headers: Record<string, unknown>): string | undefined {
  const raw = headers.authorization;
  if (typeof raw !== "string") return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(raw);
  return match?.[1];
}

function tokensEqual(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) return false;
  const left = Buffer.from(actual, "utf8");
  const right = Buffer.from(expected, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function registerAndroidModelPrototype(
  app: FastifyInstance,
  options: AndroidModelPrototypeOptions,
): void {
  const authorizeRelay = (headers: Record<string, unknown>): boolean =>
    tokensEqual(readBearerToken(headers), options.relayToken);
  const specialistGuidanceRegistry = loadDefaultPrototypeSpecialistGuidanceRegistry();

  app.addHook("onClose", async () => {
    options.provider.close();
  });

  app.get("/android-llm", async (_request, reply) =>
    reply.type("text/html; charset=utf-8").send(renderSolandraLocalModelPrototypePage())
  );

  app.get("/api/v1/prototype/android-model-relay/jobs/next", async (request, reply) => {
    reply.header("cache-control", "no-store");
    if (!authorizeRelay(request.headers as Record<string, unknown>)) {
      return reply.status(401).send({ error: "ANDROID_MODEL_RELAY_UNAUTHORIZED" });
    }
    const job = options.provider.claimNext();
    if (job === undefined) return reply.status(204).send();
    return reply.status(200).send(job);
  });

  app.post<{ Params: { jobId: string } }>(
    "/api/v1/prototype/android-model-relay/jobs/:jobId/complete",
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      if (!authorizeRelay(request.headers as Record<string, unknown>)) {
        return reply.status(401).send({ error: "ANDROID_MODEL_RELAY_UNAUTHORIZED" });
      }
      const parsed = relayCompletionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "INVALID_ANDROID_MODEL_RELAY_COMPLETION",
          details: parsed.error.flatten(),
        });
      }
      const transition = options.provider.complete(request.params.jobId, parsed.data);
      if (transition === "not_found") {
        return reply.status(404).send({ error: "ANDROID_MODEL_RELAY_JOB_NOT_FOUND" });
      }
      if (transition === "not_claimed") {
        return reply.status(409).send({ error: "ANDROID_MODEL_RELAY_JOB_NOT_CLAIMED" });
      }
      return reply.status(204).send();
    },
  );

  app.post<{ Params: { jobId: string } }>(
    "/api/v1/prototype/android-model-relay/jobs/:jobId/fail",
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      if (!authorizeRelay(request.headers as Record<string, unknown>)) {
        return reply.status(401).send({ error: "ANDROID_MODEL_RELAY_UNAUTHORIZED" });
      }
      const transition = options.provider.fail(request.params.jobId);
      if (transition === "not_found") {
        return reply.status(404).send({ error: "ANDROID_MODEL_RELAY_JOB_NOT_FOUND" });
      }
      if (transition === "not_claimed") {
        return reply.status(409).send({ error: "ANDROID_MODEL_RELAY_JOB_NOT_CLAIMED" });
      }
      return reply.status(204).send();
    },
  );

  app.post<{ Params: { conversationId: string } }>(
    "/api/v1/prototype/android-model-conversations/:conversationId/messages",
    async (request, reply) => {
      const conversationId = request.params.conversationId.trim();
      if (conversationId.length === 0 || conversationId.length > 128) {
        return reply.status(400).send({ error: "INVALID_PROTOTYPE_CONVERSATION_ID" });
      }

      const parsed = conversationRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "INVALID_PROTOTYPE_CONVERSATION",
          details: parsed.error.flatten(),
        });
      }

      let prototypeIntentVersion: PrototypeIntentVersionFixture | undefined;
      let specialistResolution: SpecialistGuidanceResolution | undefined;
      if (parsed.data.prototypeIntentVersion !== undefined) {
        try {
          prototypeIntentVersion = parsePrototypeIntentVersionFixture(parsed.data.prototypeIntentVersion);
          specialistResolution = resolvePrototypeSpecialistGuidance(
            prototypeIntentVersion,
            specialistGuidanceRegistry,
          );
        } catch (error) {
          return reply.status(400).send({
            error: "INVALID_PROTOTYPE_INTENT_VERSION_FIXTURE",
            message: error instanceof Error ? error.message : "Invalid prototype IntentVersion fixture.",
          });
        }
      }

      const specialistControl = specialistResolution?.selected === true
        ? [compileSpecialistGuidanceControl(specialistResolution.profile)]
        : [];

      try {
        const result = await options.runtime.call({
          model: options.modelName,
          messages: [
            { role: "system", content: LOCAL_MODEL_SYSTEM_PROMPT },
            ...specialistControl,
            ...parsed.data.messages,
          ],
          temperature: 0,
          maxOutputTokens: 768,
        }, {
          correlationId: `android-prototype-conversation:${conversationId}`,
          idempotencyKey: parsed.data.turnId,
          maxAttempts: 2,
        });

        const textOutput = result.response.output.find((item) => item.type === "text");
        if (textOutput?.type !== "text") {
          return reply.status(422).send({
            error: "MODEL_PROTOTYPE_TEXT_REQUIRED",
            message: "The Android local model returned no conversational text for this prototype turn.",
          });
        }

        return reply.status(200).send({
          conversationId,
          turnId: parsed.data.turnId,
          prototype: true,
          authoritative: false,
          modelSource: "android-local",
          ...(prototypeIntentVersion === undefined
            ? {}
            : { specialistGuidance: specialistGuidanceAudit(prototypeIntentVersion, specialistResolution) }),
          message: {
            role: "assistant",
            content: textOutput.text,
          },
        });
      } catch {
        return reply.status(503).send({
          error: "MODEL_PROTOTYPE_UNAVAILABLE",
          message: "The Android local-model prototype could not produce a response. Check the Android worker and local inference server, then try again.",
        });
      }
    },
  );
}
