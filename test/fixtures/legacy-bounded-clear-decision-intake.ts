import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  createApiRequestHash,
  type ApiRunControlStore,
} from "../../src/api-control-store.js";
import type { RunRequest } from "../../src/domain.js";
import { createPendingRun } from "../../src/run-execution.js";
import { deriveQualifiedLegacyBoundedRunRequest } from "./legacy-exact-planning-fidelity.js";
import type { IntentAuthorityStore } from "../../src/intent/store.js";
import type { IntentUserMessageStore } from "../../src/intent/source-message-store.js";

const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000;
const USER_TEXT_MAX_CHARS = 2_000;
const ID_MAX_CHARS = 200;
const TARGET_MAX_CHARS = 128;

const userMessageSchema = z.object({
  turnId: z.string().min(1).max(ID_MAX_CHARS),
  messageId: z.string().min(1).max(ID_MAX_CHARS),
  content: z.string().min(1).max(USER_TEXT_MAX_CHARS).refine(
    (value) => value.trim().length > 0,
    "content must contain non-whitespace USER text",
  ),
}).strict();

export interface BoundedClearDecisionIntentIntakeOptions {
  intentStore: IntentAuthorityStore;
  userMessageStore: IntentUserMessageStore;
  apiControlStore: ApiRunControlStore;
  apiSubject?: string | ((request: FastifyRequest) => string);
}

type ParsedClearDecisionIntent = {
  objective: string;
  priceMaxUsd: number;
  batteryHours: number;
};

function digestHex(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\u001f")).digest("hex");
}

function stableId(prefix: string, ...parts: string[]): string {
  return `m5k-${prefix}-${digestHex(...parts).slice(0, 32)}`;
}

function stableUuid(...parts: string[]): `${string}-${string}-${string}-${string}-${string}` {
  const digest = digestHex(...parts).slice(0, 32);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
}

function normalizeUserText(value: string): string {
  return value.trim().replaceAll("’", "'").replace(/\s+/g, " ");
}

function parseClearDecisionIntent(content: string): ParsedClearDecisionIntent | undefined {
  const normalized = normalizeUserText(content);
  const match = /^i need ((?:a|an) [a-z0-9][a-z0-9 .+'/_-]{0,120}?) under \$?([0-9][0-9,]*(?:\.[0-9]{1,2})?) with at least ([0-9]+(?:\.[0-9]+)?) hours? of battery life as a hard requirement\.? performance matters more\.?$/i.exec(normalized);
  if (!match) return undefined;

  const target = match[1]?.trim().toLowerCase();
  const priceMaxUsd = Number(match[2]?.replaceAll(",", ""));
  const batteryHours = Number(match[3]);
  if (
    !target
    || target.length > TARGET_MAX_CHARS
    || !Number.isFinite(priceMaxUsd)
    || priceMaxUsd <= 0
    || !Number.isFinite(batteryHours)
    || batteryHours <= 0
  ) {
    return undefined;
  }

  return {
    objective: `choose ${target}`,
    priceMaxUsd,
    batteryHours,
  };
}

export function registerBoundedClearDecisionIntentIntake(
  app: FastifyInstance,
  options: BoundedClearDecisionIntentIntakeOptions,
): void {
  const configuredApiSubject = options.apiSubject;
  const apiSubjectForRequest = typeof configuredApiSubject === "function"
    ? configuredApiSubject
    : () => configuredApiSubject ?? "fixture-user";

  app.post<{ Params: { conversationId: string; intentScopeId: string } }>(
    "/api/v1/conversations/:conversationId/intent-scopes/:intentScopeId/clear-user-messages",
    async (request, reply) => {
      const parsedBody = userMessageSchema.safeParse(request.body);
      if (!parsedBody.success) {
        return reply.status(400).send({ error: "INVALID_BOUNDED_CLEAR_USER_MESSAGE", details: parsedBody.error.flatten() });
      }
      const conversationId = request.params.conversationId.trim();
      const intentScopeId = request.params.intentScopeId.trim();
      if (!conversationId || !intentScopeId || conversationId.length > 128 || intentScopeId.length > 200) {
        return reply.status(400).send({ error: "INVALID_BOUNDED_CLEAR_INTENT_ROUTE" });
      }

      const parsedIntent = parseClearDecisionIntent(parsedBody.data.content);
      if (!parsedIntent) {
        return reply.status(422).send({
          error: "BOUNDED_CLEAR_INTENT_NOT_REPRESENTABLE",
          message: "This bounded acceptance slice accepts only the qualified clear price/battery/performance grammar; unsupported text cannot change canonical intent.",
        });
      }

      let sourceMessage;
      try {
        sourceMessage = await options.userMessageStore.append({
          conversationId,
          intentScopeId,
          logicalUserTurnId: parsedBody.data.turnId,
          messageId: parsedBody.data.messageId,
          messageHorizon: 1,
          content: parsedBody.data.content,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "USER message provenance conflict.";
        return reply.status(409).send({ error: "USER_MESSAGE_PROVENANCE_CONFLICT", message });
      }

      const transitionId = stableId(
        "clear-initial",
        intentScopeId,
        sourceMessage.logicalUserTurnId,
        sourceMessage.messageId,
        sourceMessage.contentDigest,
      );
      let scope = await options.intentStore.getScope(intentScopeId);
      if (!scope) {
        try {
          scope = await options.intentStore.createScope({
            intentScopeId,
            initialTransition: {
              transitionId,
              intentScopeId,
              baseIntentVersionId: null,
              logicalUserTurnId: sourceMessage.logicalUserTurnId,
              observedMessageHorizon: sourceMessage.messageHorizon,
              sourceMessageId: sourceMessage.messageId,
              sourceDigest: sourceMessage.contentDigest,
              operations: [
                { op: "SET", path: { kind: "OBJECTIVE" }, value: { state: "VALUE", value: parsedIntent.objective } },
                { op: "SET", path: { kind: "REQUIREMENT", key: "price.max.usd" }, value: { state: "VALUE", value: parsedIntent.priceMaxUsd } },
                { op: "SET", path: { kind: "REQUIREMENT", key: "batteryHours.min" }, value: { state: "VALUE", value: parsedIntent.batteryHours } },
                { op: "SET", path: { kind: "PREFERENCE", key: "performance.relativeToBattery" }, value: { state: "VALUE", value: "MORE_IMPORTANT" } },
              ],
            },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Clear intent scope creation failed.";
          return reply.status(409).send({ error: "BOUNDED_CLEAR_INTENT_SCOPE_REJECTED", message });
        }
      } else {
        const current = await options.intentStore.getVersion(scope.currentIntentVersionId);
        if (current?.version !== 1 || current.transitionId !== transitionId) {
          return reply.status(409).send({ error: "BOUNDED_CLEAR_INTENT_SCOPE_ALREADY_ADVANCED" });
        }
      }

      const version = scope ? await options.intentStore.getVersion(scope.currentIntentVersionId) : undefined;
      if (!version || version.intentScopeId !== intentScopeId) {
        return reply.status(500).send({ error: "BOUND_CLEAR_INTENT_VERSION_MISSING" });
      }

      let runRequest: RunRequest;
      try {
        runRequest = deriveQualifiedLegacyBoundedRunRequest(version.state);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Clear bounded planning failed.";
        return reply.status(422).send({ error: "BOUND_CLEAR_INTENT_PLANNING_REJECTED", message });
      }

      const runId = stableUuid("clear-run", conversationId, intentScopeId, transitionId, version.intentVersionId);
      const run = createPendingRun(conversationId, runRequest, runId);
      const canonicalRoute = [
        "/api/v1/conversations",
        encodeURIComponent(conversationId),
        "intent-scopes",
        encodeURIComponent(intentScopeId),
        "clear-user-messages",
      ].join("/");
      try {
        const submission = await options.apiControlStore.submitRun({
          run,
          intentBinding: { intentScopeId, intentVersionId: version.intentVersionId },
          dispatch: {
            logicalKey: `run:${run.id}:execute`,
            queueName: "lattice.run",
            payload: { runId: run.id, submittedVersion: run.version },
          },
          idempotency: {
            scopeKey: apiSubjectForRequest(request),
            httpMethod: "POST",
            canonicalRoute,
            idempotencyKey: `m5k:${sourceMessage.logicalUserTurnId}`,
            requestHash: createApiRequestHash({
              turnId: sourceMessage.logicalUserTurnId,
              messageId: sourceMessage.messageId,
              contentDigest: sourceMessage.contentDigest,
              intentVersionId: version.intentVersionId,
            }),
            expiresAt: new Date(Date.now() + IDEMPOTENCY_RETENTION_MS),
          },
        });
        if (submission.outcome === "conflict") {
          return reply.status(409).send({ error: "BOUND_CLEAR_INTENT_IDEMPOTENCY_CONFLICT" });
        }
        return reply.status(202).send({
          status: "RUN_ACCEPTED",
          clarificationRequired: false,
          runId: submission.response.runId,
          intentScopeId,
          intentVersionId: version.intentVersionId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Clear exact IntentVersion-bound Run creation failed.";
        return reply.status(422).send({ error: "BOUND_CLEAR_INTENT_RUN_REJECTED", message });
      }
    },
  );
}
