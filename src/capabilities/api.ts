import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getAuthenticatedSubject } from "../auth/authenticated-subject.js";
import {
  CapabilityBroker,
  CapabilityNotAuthorizedError,
  CapabilityRevokedError,
  CapabilityUnavailableError,
} from "./broker.js";
import {
  USER_AUTHORIZED_MODEL_CAPABILITY_ID,
  userModelInputSchema,
} from "./user-model-capability.js";

const invocationSchema = z.object({
  requestId: z.string().min(1).max(200),
  purpose: z.string().min(1).max(200),
  input: userModelInputSchema,
}).strict();

function productState(state: Awaited<ReturnType<CapabilityBroker["stateFor"]>>) {
  return {
    ...state,
    description: "A USER-authorized cognitive capability Solandra may use for bounded reasoning, drafting, transformation, brainstorming, or analysis.",
    authorization: "Connecting this capability grants only this generalized cognitive scope. It does not broaden plain-language Knowledge simplification authorization.",
    limitation: "Output is non-authoritative proposed work. It cannot establish USER intent, Knowledge, Recommendation, USER choice, action authorization, execution, or verification.",
    effect: "COGNITIVE_ONLY",
    trustHandling: "NON_AUTHORITATIVE_PROPOSAL",
  };
}

export function registerCapabilityBrokerApi(app: FastifyInstance, broker: CapabilityBroker): void {
  app.get("/api/v1/capabilities/user-model", async (request) => {
    const { subjectId } = getAuthenticatedSubject(request);
    return { capability: productState(await broker.stateFor(subjectId, USER_AUTHORIZED_MODEL_CAPABILITY_ID)) };
  });

  app.post("/api/v1/capabilities/user-model/connect", async (request, reply) => {
    const { subjectId } = getAuthenticatedSubject(request);
    try {
      await broker.connect(subjectId, USER_AUTHORIZED_MODEL_CAPABILITY_ID);
      return reply.status(200).send({ capability: productState(await broker.stateFor(subjectId, USER_AUTHORIZED_MODEL_CAPABILITY_ID)) });
    } catch (error) {
      if (error instanceof CapabilityUnavailableError) {
        return reply.status(503).send({ error: "USER_MODEL_CAPABILITY_UNAVAILABLE", message: error.message });
      }
      throw error;
    }
  });

  app.delete("/api/v1/capabilities/user-model/connect", async (request) => {
    const { subjectId } = getAuthenticatedSubject(request);
    await broker.disconnect(subjectId, USER_AUTHORIZED_MODEL_CAPABILITY_ID);
    return { capability: productState(await broker.stateFor(subjectId, USER_AUTHORIZED_MODEL_CAPABILITY_ID)) };
  });

  app.post("/api/v1/solandra/capabilities/user-model", async (request, reply) => {
    const { subjectId } = getAuthenticatedSubject(request);
    const body = invocationSchema.parse(request.body);
    try {
      const result = await broker.invoke({
        subjectId,
        capabilityId: USER_AUTHORIZED_MODEL_CAPABILITY_ID,
        requestId: body.requestId,
        purpose: body.purpose,
        payload: body.input,
      });
      return reply.status(200).send({ result });
    } catch (error) {
      if (error instanceof CapabilityUnavailableError) {
        return reply.status(503).send({ error: "USER_MODEL_CAPABILITY_UNAVAILABLE", message: error.message });
      }
      if (error instanceof CapabilityNotAuthorizedError) {
        return reply.status(403).send({ error: "USER_MODEL_CAPABILITY_NOT_AUTHORIZED", message: error.message });
      }
      if (error instanceof CapabilityRevokedError) {
        return reply.status(409).send({ error: "USER_MODEL_CAPABILITY_REVOKED", message: error.message });
      }
      throw error;
    }
  });
}
