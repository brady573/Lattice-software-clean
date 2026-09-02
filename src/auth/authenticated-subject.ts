import type { FastifyInstance, FastifyRequest } from "fastify";

export const AUTHENTICATED_SUBJECT_ID_MAX_CHARS = 200;

export interface AuthenticatedSubject {
  subjectId: string;
}

export type AuthenticatedSubjectResolver = (
  request: FastifyRequest,
) => AuthenticatedSubject | undefined | Promise<AuthenticatedSubject | undefined>;

const authenticatedSubjects = new WeakMap<FastifyRequest, AuthenticatedSubject>();

function normalizeSubject(subject: AuthenticatedSubject | undefined): AuthenticatedSubject | undefined {
  if (subject === undefined) return undefined;
  const subjectId = subject.subjectId.trim();
  if (!subjectId || subjectId.length > AUTHENTICATED_SUBJECT_ID_MAX_CHARS) return undefined;
  return Object.freeze({ subjectId });
}

export function createDevelopmentFixtureSubjectResolver(
  subjectId: string,
): AuthenticatedSubjectResolver {
  const subject = normalizeSubject({ subjectId });
  if (subject === undefined) {
    throw new Error("Development fixture subjectId must contain between 1 and 200 non-whitespace characters.");
  }
  return () => subject;
}

export function getAuthenticatedSubject(request: FastifyRequest): AuthenticatedSubject {
  const subject = authenticatedSubjects.get(request);
  if (subject === undefined) {
    throw new Error("AuthenticatedSubject is unavailable for this request.");
  }
  return subject;
}

export interface AuthenticatedSubjectBoundaryOptions {
  resolveSubject: AuthenticatedSubjectResolver;
}

function requiresAuthenticatedSubject(request: FastifyRequest): boolean {
  const path = request.url.split("?", 1)[0] ?? request.url;
  return path.startsWith("/api/v1/") && !path.startsWith("/api/v1/prototype/");
}

/**
 * Establish the request security context for authoritative API paths.
 * Provider-specific credentials are consumed only by the injected resolver;
 * canonical Product systems receive only AuthenticatedSubject.subjectId.
 */
export function registerAuthenticatedSubjectBoundary(
  app: FastifyInstance,
  options: AuthenticatedSubjectBoundaryOptions,
): void {
  app.addHook("preHandler", async (request, reply) => {
    if (!requiresAuthenticatedSubject(request)) return;

    let subject: AuthenticatedSubject | undefined;
    try {
      subject = normalizeSubject(await options.resolveSubject(request));
    } catch {
      subject = undefined;
    }

    if (subject === undefined) {
      return reply.status(401).send({ error: "AUTHENTICATION_REQUIRED" });
    }

    authenticatedSubjects.set(request, subject);
  });
}
