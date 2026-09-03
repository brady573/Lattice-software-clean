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
import type { IntentUserMessage, IntentUserMessageStore } from "../../src/intent/source-message-store.js";

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

export interface BoundedDecisionIntentIntakeOptions {
  intentStore: IntentAuthorityStore;
  userMessageStore: IntentUserMessageStore;
  apiControlStore: ApiRunControlStore;
  apiSubject?: string | ((request: FastifyRequest) => string);
}

type ParsedBoundedDecisionIntent = {
  objective: string;
  priceMaxUsd: number;
  batteryHours: number;
};

function stableId(prefix: string, ...parts: string[]): string {
  const digest = createHash("sha256").update(parts.join("\u001f")).digest("hex").slice(0, 32);
  return `m5i-${prefix}-${digest}`;
}

function normalizeUserText(value: string): string {
  return value.trim().replaceAll("’", "'").replace(/\s+/g, " ");
}

function parseBoundedDecisionIntent(content: string): ParsedBoundedDecisionIntent | undefined {
  const normalized = normalizeUserText(content);
  const match = /^i need ((?:a|an) [a-z0-9][a-z0-9 .+'/_-]{0,120}?) under \$?([0-9][0-9,]*(?:\.[0-9]{1,2})?)\.? i(?:'d| would) like at least ([0-9]+(?:\.[0-9]+)?) hours? of battery life,? but performance matters more\.?$/i.exec(normalized);
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

function isHardRequirementConfirmation(content: string): boolean {
  return /^hard requirement\.?$/i.test(normalizeUserText(content));
}

function validConfirmedDisposition(disposition: {
  disposition: string;
  replayedDisposition?: string;
}): boolean {
  return disposition.disposition === "COMMITTED"
    || disposition.disposition === "SEMANTIC_NOOP"
    || (disposition.disposition === "REPLAYED"
      && (disposition.replayedDisposition === "COMMITTED"
        || disposition.replayedDisposition === "SEMANTIC_NOOP"));
}

export function registerBoundedDecisionIntentIntake(
  app: FastifyInstance,
  options: BoundedDecisionIntentIntakeOptions,
): void {
  const configuredApiSubject = options.apiSubject;
  const apiSubjectForRequest = typeof configuredApiSubject === "function"
    ? configuredApiSubject
    : () => configuredApiSubject ?? "fixture-user";

  app.post<{ Params: { conversationId: string; intentScopeId: string } }>(
    "/api/v1/conversations/:conversationId/intent-scopes/:intentScopeId/user-messages",
    async (request, reply) => {
      const parsedBody = userMessageSchema.safeParse(request.body);
      if (!parsedBody.success) {
        return reply.status(400).send({ error: "INVALID_BOUNDED_USER_MESSAGE", details: parsedBody.error.flatten() });
      }
      const conversationId = request.params.conversationId.trim();
      const intentScopeId = request.params.intentScopeId.trim();
      if (!conversationId || !intentScopeId || conversationId.length > 128 || intentScopeId.length > 200) {
        return reply.status(400).send({ error: "INVALID_BOUNDED_INTENT_ROUTE" });
      }

      const parsedIntent = parseBoundedDecisionIntent(parsedBody.data.content);
      if (!parsedIntent) {
        return reply.status(422).send({
          error: "BOUNDED_INTENT_NOT_REPRESENTABLE",
          message: "This bounded decision slice accepts only the qualified price/battery/performance intake grammar; unsupported text cannot change canonical intent.",
        });
      }

      let sourceMessage: IntentUserMessage;
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

      const initialTransitionId = stableId(
        "initial",
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
              transitionId: initialTransitionId,
              intentScopeId,
              baseIntentVersionId: null,
              logicalUserTurnId: sourceMessage.logicalUserTurnId,
              observedMessageHorizon: sourceMessage.messageHorizon,
              sourceMessageId: sourceMessage.messageId,
              sourceDigest: sourceMessage.contentDigest,
              operations: [
                {
                  op: "SET",
                  path: { kind: "OBJECTIVE" },
                  value: { state: "VALUE", value: parsedIntent.objective },
                },
                {
                  op: "SET",
                  path: { kind: "REQUIREMENT", key: "price.max.usd" },
                  value: { state: "VALUE", value: parsedIntent.priceMaxUsd },
                },
                {
                  op: "SET",
                  path: { kind: "PREFERENCE", key: "performance.relativeToBattery" },
                  value: { state: "VALUE", value: "MORE_IMPORTANT" },
                },
              ],
            },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Intent scope creation failed.";
          return reply.status(409).send({ error: "BOUNDED_INTENT_SCOPE_REJECTED", message });
        }
      } else {
        const current = await options.intentStore.getVersion(scope.currentIntentVersionId);
        if (current?.version !== 1 || current.transitionId !== initialTransitionId) {
          return reply.status(409).send({
            error: "BOUNDED_INTENT_SCOPE_ALREADY_ADVANCED",
            message: "The bounded initial USER turn cannot be replayed onto a different or advanced IntentVersion.",
          });
        }
      }

      if (!scope) return reply.status(500).send({ error: "BOUND_INTENT_SCOPE_MISSING" });
      const baseIntentVersionId = scope.currentIntentVersionId;
      const proposalId = stableId(
        "battery-hard-proposal",
        intentScopeId,
        baseIntentVersionId,
        sourceMessage.contentDigest,
        String(parsedIntent.batteryHours),
      );
      let pending = await options.intentStore.getPendingProposal(proposalId);
      if (!pending) {
        try {
          pending = await options.intentStore.createPendingProposal({
            proposalId,
            intentScopeId,
            baseIntentVersionId,
            observedMessageHorizon: sourceMessage.messageHorizon,
            sourceMessageId: sourceMessage.messageId,
            sourceDigest: sourceMessage.contentDigest,
            operations: [
              {
                op: "SET",
                path: { kind: "REQUIREMENT", key: "batteryHours.min" },
                value: { state: "VALUE", value: parsedIntent.batteryHours },
              },
            ],
            materiality: "MATERIAL",
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Material clarification proposal failed.";
          return reply.status(409).send({ error: "BOUNDED_CLARIFICATION_REJECTED", message });
        }
      }
      if (!pending) return reply.status(500).send({ error: "BOUND_CLARIFICATION_MISSING" });
      if (
        pending.intentScopeId !== intentScopeId
        || pending.baseIntentVersionId !== baseIntentVersionId
        || pending.sourceMessageId !== sourceMessage.messageId
        || pending.sourceDigest !== sourceMessage.contentDigest
      ) {
        return reply.status(409).send({ error: "BOUNDED_CLARIFICATION_PROVENANCE_CONFLICT" });
      }

      return reply.status(202).send({
        status: "NEEDS_CLARIFICATION",
        intentScopeId,
        intentVersionId: baseIntentVersionId,
        proposalId: pending.proposalId,
        proposalDigest: pending.proposalDigest,
        question: `You said you'd like at least ${parsedIntent.batteryHours} hours of battery life. Should that be a hard requirement?`,
        confirmationExample: "Hard requirement.",
      });
    },
  );

  app.post<{ Params: { conversationId: string; intentScopeId: string; proposalId: string } }>(
    "/api/v1/conversations/:conversationId/intent-scopes/:intentScopeId/clarifications/:proposalId/confirm",
    async (request, reply) => {
      const parsedBody = userMessageSchema.safeParse(request.body);
      if (!parsedBody.success) {
        return reply.status(400).send({ error: "INVALID_BOUNDED_USER_MESSAGE", details: parsedBody.error.flatten() });
      }
      const conversationId = request.params.conversationId.trim();
      const intentScopeId = request.params.intentScopeId.trim();
      const proposalId = request.params.proposalId.trim();
      if (!conversationId || !intentScopeId || !proposalId) {
        return reply.status(400).send({ error: "INVALID_BOUNDED_INTENT_ROUTE" });
      }

      const pending = await options.intentStore.getPendingProposal(proposalId);
      if (!pending || pending.intentScopeId !== intentScopeId) {
        return reply.status(404).send({ error: "BOUND_CLARIFICATION_NOT_FOUND" });
      }
      if (pending.status === "STALE") {
        return reply.status(409).send({ error: "BOUND_CLARIFICATION_STALE" });
      }

      if (!isHardRequirementConfirmation(parsedBody.data.content)) {
        return reply.status(422).send({
          error: "BOUNDED_CONFIRMATION_NOT_REPRESENTABLE",
          message: "This bounded decision slice accepts only exact hard-requirement confirmation for the pending battery proposal; unsupported text cannot change canonical intent.",
        });
      }

      let sourceMessage: IntentUserMessage;
      try {
        sourceMessage = await options.userMessageStore.append({
          conversationId,
          intentScopeId,
          logicalUserTurnId: parsedBody.data.turnId,
          messageId: parsedBody.data.messageId,
          messageHorizon: pending.observedMessageHorizon + 1,
          content: parsedBody.data.content,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "USER message provenance conflict.";
        return reply.status(409).send({ error: "USER_MESSAGE_PROVENANCE_CONFLICT", message });
      }

      const transitionId = stableId(
        "confirm",
        intentScopeId,
        proposalId,
        sourceMessage.logicalUserTurnId,
        sourceMessage.messageId,
        sourceMessage.contentDigest,
      );
      const confirmation = await options.intentStore.confirmPendingProposal({
        transitionId,
        proposalId,
        expectedProposalDigest: pending.proposalDigest,
        intentScopeId,
        baseIntentVersionId: pending.baseIntentVersionId,
        logicalUserTurnId: sourceMessage.logicalUserTurnId,
        observedMessageHorizon: sourceMessage.messageHorizon,
        sourceMessageId: sourceMessage.messageId,
        sourceDigest: sourceMessage.contentDigest,
      });
      if (!validConfirmedDisposition(confirmation) || !confirmation.resultingIntentVersionId) {
        const statusCode = confirmation.disposition === "REJECTED_STALE" ? 409 : 422;
        return reply.status(statusCode).send({
          error: "BOUND_CLARIFICATION_CONFIRMATION_REJECTED",
          disposition: confirmation.disposition,
        });
      }

      const version = await options.intentStore.getVersion(confirmation.resultingIntentVersionId);
      if (!version || version.intentScopeId !== intentScopeId) {
        return reply.status(500).send({ error: "CONFIRMED_INTENT_VERSION_MISSING" });
      }

      let runRequest: RunRequest;
      try {
        runRequest = deriveQualifiedLegacyBoundedRunRequest(version.state);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Bounded Run planning failed.";
        return reply.status(422).send({ error: "BOUND_INTENT_PLANNING_REJECTED", message });
      }

      const run = createPendingRun(conversationId, runRequest);
      const canonicalRoute = [
        "/api/v1/conversations",
        encodeURIComponent(conversationId),
        "intent-scopes",
        encodeURIComponent(intentScopeId),
        "clarifications",
        encodeURIComponent(proposalId),
        "confirm",
      ].join("/");
      try {
        const submission = await options.apiControlStore.submitRun({
          run,
          intentBinding: {
            intentScopeId,
            intentVersionId: version.intentVersionId,
          },
          dispatch: {
            logicalKey: `run:${run.id}:execute`,
            queueName: "lattice.run",
            payload: { runId: run.id, submittedVersion: run.version },
          },
          idempotency: {
            scopeKey: apiSubjectForRequest(request),
            httpMethod: "POST",
            canonicalRoute,
            idempotencyKey: `m5i:${sourceMessage.logicalUserTurnId}`,
            requestHash: createApiRequestHash({
              proposalDigest: pending.proposalDigest,
              turnId: sourceMessage.logicalUserTurnId,
              messageId: sourceMessage.messageId,
              contentDigest: sourceMessage.contentDigest,
            }),
            expiresAt: new Date(Date.now() + IDEMPOTENCY_RETENTION_MS),
          },
        });
        if (submission.outcome === "conflict") {
          return reply.status(409).send({ error: "BOUND_CONFIRMATION_IDEMPOTENCY_CONFLICT" });
        }
        return reply.status(202).send({
          status: "RUN_ACCEPTED",
          runId: submission.response.runId,
          intentScopeId,
          intentVersionId: version.intentVersionId,
          proposalId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Exact IntentVersion-bound Run creation failed.";
        return reply.status(422).send({ error: "BOUND_INTENT_RUN_REJECTED", message });
      }
    },
  );
}
