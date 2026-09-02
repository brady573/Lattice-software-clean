import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getAuthenticatedSubject } from "../auth/authenticated-subject.js";
import { reuseActiveUserPreference } from "./user-preference-continuity.js";
import {
  UserPreferenceConflictError,
  UserPreferenceNotFoundError,
  UserPreferenceVersionConflictError,
  type UserPreferenceStore,
} from "./user-preference-store.js";
import type { IntentAuthorityStore } from "./store.js";
import type { IntentUserMessage, IntentUserMessageStore } from "./source-message-store.js";
import { intentSetValueSchema, type IntentTransitionResult } from "./types.js";

const ID_MAX_CHARS = 200;
const SEMANTIC_KEY_MAX_CHARS = 200;

const sourceMessageShape = {
  sourceMessageId: z.string().min(1).max(ID_MAX_CHARS),
};

const rememberPreferenceSchema = z.object({
  preferenceId: z.string().min(1).max(ID_MAX_CHARS),
  semanticKey: z.string().min(1).max(SEMANTIC_KEY_MAX_CHARS).refine(
    (value) => value.trim() === value,
    "semanticKey must be trimmed.",
  ),
  value: intentSetValueSchema,
  ...sourceMessageShape,
}).strict();

const versionedPreferenceControlSchema = z.object({
  expectedPreferenceVersion: z.number().int().positive(),
  ...sourceMessageShape,
}).strict();

const scopedPreferenceControlSchema = versionedPreferenceControlSchema.extend({
  transitionId: z.string().min(1).max(ID_MAX_CHARS),
  baseIntentVersionId: z.string().min(1).max(ID_MAX_CHARS),
}).strict();

export interface UserPreferenceControlsApiOptions {
  preferenceStore: UserPreferenceStore;
  intentStore: IntentAuthorityStore;
  userMessageStore: IntentUserMessageStore;
}

async function sourceMessageForControl(
  store: IntentUserMessageStore,
  conversationId: string,
  sourceMessageId: string,
  intentScopeId?: string,
): Promise<IntentUserMessage | undefined> {
  const message = await store.get(sourceMessageId);
  if (!message || message.conversationId !== conversationId) return undefined;
  if (intentScopeId !== undefined && message.intentScopeId !== intentScopeId) return undefined;
  return message;
}

function explicitProvenance(message: IntentUserMessage) {
  return {
    kind: "EXPLICIT_USER" as const,
    logicalUserTurnId: message.logicalUserTurnId,
    sourceMessageId: message.messageId,
    sourceDigest: message.contentDigest,
  };
}

function sendTransitionResult(
  reply: { status(code: number): { send(payload: unknown): unknown } },
  result: IntentTransitionResult,
) {
  if (result.disposition === "REJECTED_STALE") {
    return reply.status(409).send({ error: "INTENT_VERSION_STALE", result });
  }
  if (result.disposition === "REJECTED_INVALID") {
    return reply.status(409).send({ error: "INTENT_TRANSITION_REJECTED", result });
  }
  return reply.status(200).send({ result });
}

function preferenceError(
  reply: { status(code: number): { send(payload: unknown): unknown } },
  error: unknown,
) {
  if (error instanceof UserPreferenceNotFoundError) {
    return reply.status(404).send({ error: "USER_PREFERENCE_NOT_FOUND" });
  }
  if (error instanceof UserPreferenceVersionConflictError) {
    return reply.status(409).send({ error: "USER_PREFERENCE_VERSION_CONFLICT" });
  }
  if (error instanceof UserPreferenceConflictError) {
    return reply.status(409).send({ error: "USER_PREFERENCE_CONFLICT" });
  }
  throw error;
}

export function registerUserPreferenceControlsApi(
  app: FastifyInstance,
  options: UserPreferenceControlsApiOptions,
): void {
  app.get("/api/v1/preferences", async (request, reply) => {
    const { subjectId } = getAuthenticatedSubject(request);
    const preferences = await options.preferenceStore.listActive(subjectId);
    return reply.status(200).send({ preferences });
  });

  app.post<{ Params: { conversationId: string } }>(
    "/api/v1/conversations/:conversationId/preferences",
    async (request, reply) => {
      const parsed = rememberPreferenceSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "INVALID_USER_PREFERENCE_CONTROL", details: parsed.error.flatten() });
      }
      const source = await sourceMessageForControl(
        options.userMessageStore,
        request.params.conversationId,
        parsed.data.sourceMessageId,
      );
      if (!source) return reply.status(404).send({ error: "USER_MESSAGE_NOT_FOUND" });
      const { subjectId } = getAuthenticatedSubject(request);
      try {
        const preference = await options.preferenceStore.create({
          preferenceId: parsed.data.preferenceId,
          ownerSubjectId: subjectId,
          semanticKey: parsed.data.semanticKey,
          value: parsed.data.value,
          provenance: explicitProvenance(source),
        });
        return reply.status(201).send({ preference });
      } catch (error) {
        return preferenceError(reply, error);
      }
    },
  );

  app.post<{ Params: { conversationId: string; preferenceId: string } }>(
    "/api/v1/conversations/:conversationId/preferences/:preferenceId/forget",
    async (request, reply) => {
      const parsed = versionedPreferenceControlSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "INVALID_USER_PREFERENCE_CONTROL", details: parsed.error.flatten() });
      }
      const source = await sourceMessageForControl(
        options.userMessageStore,
        request.params.conversationId,
        parsed.data.sourceMessageId,
      );
      if (!source) return reply.status(404).send({ error: "USER_MESSAGE_NOT_FOUND" });
      const { subjectId } = getAuthenticatedSubject(request);
      try {
        const preference = await options.preferenceStore.revoke({
          preferenceId: request.params.preferenceId,
          ownerSubjectId: subjectId,
          expectedVersion: parsed.data.expectedPreferenceVersion,
          provenance: explicitProvenance(source),
        });
        return reply.status(200).send({ preference });
      } catch (error) {
        return preferenceError(reply, error);
      }
    },
  );

  app.post<{ Params: { conversationId: string; intentScopeId: string; preferenceId: string } }>(
    "/api/v1/conversations/:conversationId/intent-scopes/:intentScopeId/preferences/:preferenceId/apply",
    async (request, reply) => {
      const parsed = scopedPreferenceControlSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "INVALID_USER_PREFERENCE_CONTROL", details: parsed.error.flatten() });
      }
      const source = await sourceMessageForControl(
        options.userMessageStore,
        request.params.conversationId,
        parsed.data.sourceMessageId,
        request.params.intentScopeId,
      );
      if (!source) return reply.status(404).send({ error: "USER_MESSAGE_NOT_FOUND" });
      const { subjectId } = getAuthenticatedSubject(request);
      try {
        const result = await reuseActiveUserPreference(options.preferenceStore, options.intentStore, {
          preferenceId: request.params.preferenceId,
          ownerSubjectId: subjectId,
          expectedPreferenceVersion: parsed.data.expectedPreferenceVersion,
          transitionId: parsed.data.transitionId,
          intentScopeId: request.params.intentScopeId,
          baseIntentVersionId: parsed.data.baseIntentVersionId,
          logicalUserTurnId: source.logicalUserTurnId,
          observedMessageHorizon: source.messageHorizon,
          sourceMessageId: source.messageId,
          sourceDigest: source.contentDigest,
        });
        return sendTransitionResult(reply, result);
      } catch (error) {
        return preferenceError(reply, error);
      }
    },
  );

  app.post<{ Params: { conversationId: string; intentScopeId: string; preferenceId: string } }>(
    "/api/v1/conversations/:conversationId/intent-scopes/:intentScopeId/preferences/:preferenceId/exclude",
    async (request, reply) => {
      const parsed = scopedPreferenceControlSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "INVALID_USER_PREFERENCE_CONTROL", details: parsed.error.flatten() });
      }
      const source = await sourceMessageForControl(
        options.userMessageStore,
        request.params.conversationId,
        parsed.data.sourceMessageId,
        request.params.intentScopeId,
      );
      if (!source) return reply.status(404).send({ error: "USER_MESSAGE_NOT_FOUND" });
      const { subjectId } = getAuthenticatedSubject(request);
      const preference = await options.preferenceStore.getActive(request.params.preferenceId, subjectId);
      if (!preference) return reply.status(404).send({ error: "USER_PREFERENCE_NOT_FOUND" });
      if (preference.version !== parsed.data.expectedPreferenceVersion) {
        return reply.status(409).send({ error: "USER_PREFERENCE_VERSION_CONFLICT" });
      }
      const result = await options.intentStore.applyTransition({
        transitionId: parsed.data.transitionId,
        intentScopeId: request.params.intentScopeId,
        baseIntentVersionId: parsed.data.baseIntentVersionId,
        logicalUserTurnId: source.logicalUserTurnId,
        observedMessageHorizon: source.messageHorizon,
        sourceMessageId: source.messageId,
        sourceDigest: source.contentDigest,
        operations: [{
          op: "REMOVE",
          path: { kind: "PREFERENCE", key: preference.semanticKey },
        }],
      });
      return sendTransitionResult(reply, result);
    },
  );
}
