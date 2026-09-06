import type { FastifyInstance } from "fastify";
import { getAuthenticatedSubject } from "./auth/authenticated-subject.js";
import {
  ModelAssistanceCapabilityService,
  ModelAssistanceUnavailableError,
} from "./model-assistance-capability.js";

export function registerModelAssistanceApi(
  app: FastifyInstance,
  service: ModelAssistanceCapabilityService,
): void {
  app.get("/api/v1/capabilities/model-assistance", async (request) => {
    const { subjectId } = getAuthenticatedSubject(request);
    return { capability: await service.stateFor(subjectId) };
  });

  app.post("/api/v1/capabilities/model-assistance/connect", async (request, reply) => {
    const { subjectId } = getAuthenticatedSubject(request);
    try {
      return reply.status(200).send({ capability: await service.connect(subjectId) });
    } catch (error) {
      if (error instanceof ModelAssistanceUnavailableError) {
        return reply.status(503).send({
          error: "MODEL_ASSISTANCE_UNAVAILABLE",
          message: error.message,
        });
      }
      throw error;
    }
  });

  app.delete("/api/v1/capabilities/model-assistance/connect", async (request) => {
    const { subjectId } = getAuthenticatedSubject(request);
    return { capability: await service.disconnect(subjectId) };
  });
}
