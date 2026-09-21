import type { FastifyInstance } from "fastify";
import { getAuthenticatedSubject } from "./authenticated-subject.js";

/**
 * Neutral Product boundary for proving that the current request has an
 * authenticated subject. It carries no capability authorization semantics.
 */
export function registerAuthenticatedSessionApi(app: FastifyInstance): void {
  app.get("/api/v1/auth/session", async (request) => {
    const { subjectId } = getAuthenticatedSubject(request);
    return {
      authenticated: true as const,
      subjectId,
    };
  });
}
