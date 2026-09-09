import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { RuntimeConfig } from "../runtime-config.js";
import type { AuthenticatedSubject, AuthenticatedSubjectResolver } from "./authenticated-subject.js";

export const OWNER_SUBJECT_ID = "owner";
export const OWNER_ACCESS_TOKEN_MIN_CHARS = 32;
export const OWNER_ACCESS_TOKEN_MAX_CHARS = 512;

function validateOwnerAccessToken(value: string): string {
  if (
    value.length < OWNER_ACCESS_TOKEN_MIN_CHARS
    || value.length > OWNER_ACCESS_TOKEN_MAX_CHARS
    || value !== value.trim()
    || !/^[\x21-\x7e]+$/u.test(value)
  ) {
    throw new Error(
      "LATTICE_OWNER_ACCESS_TOKEN must contain between 32 and 512 visible non-whitespace ASCII characters.",
    );
  }
  return value;
}

function bearerCredential(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (typeof header !== "string") return undefined;
  const match = /^Bearer ([\x21-\x7e]+)$/u.exec(header);
  return match?.[1];
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function createOwnerAccessSubjectResolver(
  accessToken: string,
): AuthenticatedSubjectResolver {
  const expectedDigest = digest(validateOwnerAccessToken(accessToken));
  const owner: AuthenticatedSubject = Object.freeze({ subjectId: OWNER_SUBJECT_ID });

  return (request) => {
    const credential = bearerCredential(request);
    if (credential === undefined) return undefined;
    const suppliedDigest = digest(credential);
    return timingSafeEqual(expectedDigest, suppliedDigest) ? owner : undefined;
  };
}

/** Canonical composition boundary for the one-owner hosted Product. */
export function resolveCanonicalOwnerSubjectResolver(
  config: RuntimeConfig,
  env: NodeJS.ProcessEnv = process.env,
): AuthenticatedSubjectResolver | undefined {
  const configured = env.LATTICE_OWNER_ACCESS_TOKEN;
  if (configured === undefined) return undefined;

  if (config.deploymentMode !== "durable" || config.authenticationMode !== "required") {
    throw new Error(
      "LATTICE_OWNER_ACCESS_TOKEN is supported only with durable required authentication.",
    );
  }

  return createOwnerAccessSubjectResolver(configured);
}
