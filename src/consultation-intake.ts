import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { createApiRequestHash, type ApiRunControlStore } from "./api-control-store.js";
import { consultationRunRequestSchema } from "./domain.js";
import type { IntentUserMessageStore } from "./intent/source-message-store.js";
import type { IntentAuthorityStore } from "./intent/store.js";
import type { IntentTransitionCommand } from "./intent/types.js";
import { buildRunOutcome } from "./outcome.js";
import { createPendingRun } from "./run-execution.js";
import type { RunStore } from "./run-store.js";
import { deriveQualifiedLegacyBoundedRunRequest } from "./intent/exact-planning-fidelity.js";

const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1_000;

type ResourceNeed = "NONE" | "CHECKLIST" | "PREPARED_MESSAGE";

const consultationTurnSchema = z.object({
  turnId: z.string().min(1).max(200),
  message: z.string().min(1).max(8_000).refine((value) => value.trim().length > 0, "message must not be blank"),
  context: z.array(z.string().min(1).max(4_000)).max(32).optional(),
  prepare: z.enum(["CHECKLIST", "PREPARED_MESSAGE"]).optional(),
}).strict();

const clarificationTurnSchema = z.object({
  turnId: z.string().min(1).max(200),
  message: z.string().min(1).max(8_000).optional(),
  messageId: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(8_000).optional(),
}).strict().refine(
  (value) => (value.message ?? value.content ?? "").trim().length > 0,
  "message or content must contain non-whitespace text",
);

export interface ConsultationIntakeOptions {
  intentStore: IntentAuthorityStore;
  userMessageStore: IntentUserMessageStore;
  apiControlStore: ApiRunControlStore;
  runStore: RunStore;
  apiSubject?: string | ((request: FastifyRequest) => string);
}

export interface ExplicitConsultationInterpretation {
  objective: string;
  resourceNeed: ResourceNeed;
  authority: "EXPLICIT_USER";
}

function digestHex(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\u001f")).digest("hex");
}

function stableUuid(...parts: string[]): `${string}-${string}-${string}-${string}-${string}` {
  const digest = digestHex(...parts).slice(0, 32);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
}

type MaterialDecisionClarification = { objective: string; priceMaxUsd: number; batteryHours: number };

function parseMaterialDecisionClarification(message: string): MaterialDecisionClarification | undefined {
  const normalized = message.trim().replaceAll("’", "'").replace(/\s+/g, " ");
  const match = /^i need ((?:a|an) [a-z0-9][a-z0-9 .+'/_-]{0,120}?) under \$?([0-9][0-9,]*(?:\.[0-9]{1,2})?)\.? i(?:'d| would) like at least ([0-9]+(?:\.[0-9]+)?) hours? of battery life,? but performance matters more\.?$/i.exec(normalized);
  if (!match) return undefined;
  const priceMaxUsd = Number(match[2]?.replaceAll(",", ""));
  const batteryHours = Number(match[3]);
  if (!match[1] || !Number.isFinite(priceMaxUsd) || priceMaxUsd <= 0 || !Number.isFinite(batteryHours) || batteryHours <= 0) return undefined;
  return { objective: `choose ${match[1].trim().toLowerCase()}`, priceMaxUsd, batteryHours };
}

function isHardRequirementConfirmation(message: string): boolean {
  return /^(?:hard requirement|yes|yes please|that's right|that'?s correct|correct|make it hard)\.?$/i.test(message.trim().replace(/\s+/g, " "));
}

/**
 * Interpret only explicit user-authored material. This boundary deliberately
 * avoids manufacturing constraints, preferences, candidates, or decisions.
 * A future model interpreter can propose inferred material behind confirmation
 * without changing the primary consultation endpoint or Run contract.
 */
export function interpretExplicitConsultationTurn(
  message: string,
  explicitPrepare?: Exclude<ResourceNeed, "NONE">,
): ExplicitConsultationInterpretation {
  if (explicitPrepare) {
    return { objective: message, resourceNeed: explicitPrepare, authority: "EXPLICIT_USER" };
  }
  const normalized = message.trim().toLowerCase();
  const asksToPrepare = /\b(?:prepare|create|make|build|draft|write|compose)\b/u.test(normalized);
  if (asksToPrepare && /\b(?:checklist|check list)\b/u.test(normalized)) {
    return { objective: message, resourceNeed: "CHECKLIST", authority: "EXPLICIT_USER" };
  }
  if (asksToPrepare && /\b(?:message|email|note|reply|response)\b/u.test(normalized)) {
    return { objective: message, resourceNeed: "PREPARED_MESSAGE", authority: "EXPLICIT_USER" };
  }
  return { objective: message, resourceNeed: "NONE", authority: "EXPLICIT_USER" };
}

export function registerConsultationIntake(app: FastifyInstance, options: ConsultationIntakeOptions): void {
  const configuredApiSubject = options.apiSubject;
  const apiSubjectForRequest = typeof configuredApiSubject === "function"
    ? configuredApiSubject
    : () => configuredApiSubject ?? "fixture-user";

  app.post<{ Params: { conversationId: string } }>(
    "/api/v1/conversations/:conversationId/turns",
    async (request, reply) => {
      const parsed = consultationTurnSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "INVALID_CONSULTATION_TURN", details: parsed.error.flatten() });
      }
      const conversationId = request.params.conversationId.trim();
      if (!conversationId || conversationId.length > 128) {
        return reply.status(400).send({ error: "INVALID_CONVERSATION_ID" });
      }

      const intentScopeId = `consultation:${conversationId}`;
      const messageId = stableUuid("consultation-message", conversationId, parsed.data.turnId);
      const existing = await options.userMessageStore.get(messageId);
      const history = existing ? [] : await options.userMessageStore.listByConversation(conversationId);
      const messageHorizon = existing?.messageHorizon
        ?? Math.max(0, ...history.map((message) => message.messageHorizon)) + 1;

      let sourceMessage;
      try {
        sourceMessage = await options.userMessageStore.append({
          conversationId,
          intentScopeId,
          logicalUserTurnId: parsed.data.turnId,
          messageId,
          messageHorizon,
          content: parsed.data.message,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "USER message provenance conflict.";
        return reply.status(409).send({ error: "USER_MESSAGE_PROVENANCE_CONFLICT", message });
      }

      const interpretation = interpretExplicitConsultationTurn(sourceMessage.content, parsed.data.prepare);
      const materialClarification = parseMaterialDecisionClarification(sourceMessage.content);
      if (materialClarification) {
        const initialTransition: IntentTransitionCommand = {
          transitionId: stableUuid("consultation-material-initial", conversationId, sourceMessage.messageId),
          intentScopeId,
          baseIntentVersionId: null,
          logicalUserTurnId: sourceMessage.logicalUserTurnId,
          observedMessageHorizon: sourceMessage.messageHorizon,
          sourceMessageId: sourceMessage.messageId,
          sourceDigest: sourceMessage.contentDigest,
          operations: [
            { op: "SET", path: { kind: "OBJECTIVE" }, value: { state: "VALUE", value: materialClarification.objective } },
            { op: "SET", path: { kind: "REQUIREMENT", key: "price.max.usd" }, value: { state: "VALUE", value: materialClarification.priceMaxUsd } },
            { op: "SET", path: { kind: "PREFERENCE", key: "performance.relativeToBattery" }, value: { state: "VALUE", value: "MORE_IMPORTANT" } },
          ],
        };
        const existingScope = await options.intentStore.getScope(intentScopeId);
        if (existingScope) return reply.status(409).send({ error: "INTENT_SCOPE_ALREADY_STARTED" });
        const scope = await options.intentStore.createScope({ intentScopeId, kind: "consultation", initialTransition });
        const proposalId = stableUuid("consultation-material-proposal", conversationId, scope.currentIntentVersionId, sourceMessage.contentDigest, String(materialClarification.batteryHours));
        const proposal = await options.intentStore.createPendingProposal({
          proposalId,
          intentScopeId,
          baseIntentVersionId: scope.currentIntentVersionId,
          observedMessageHorizon: sourceMessage.messageHorizon,
          sourceMessageId: sourceMessage.messageId,
          sourceDigest: sourceMessage.contentDigest,
          operations: [{ op: "SET", path: { kind: "REQUIREMENT", key: "batteryHours.min" }, value: { state: "VALUE", value: materialClarification.batteryHours } }],
          materiality: "MATERIAL",
        });
        return reply.status(202).send({
          status: "NEEDS_CLARIFICATION",
          intentScopeId,
          intentVersionId: scope.currentIntentVersionId,
          proposalId: proposal.proposalId,
          proposalDigest: proposal.proposalDigest,
          question: `You said you'd like at least ${materialClarification.batteryHours} hours of battery life. Should that be a hard requirement?`,
          confirmationExample: "Hard requirement.",
        });
      }
      const transition: IntentTransitionCommand = {
        transitionId: stableUuid("consultation-transition", conversationId, sourceMessage.messageId),
        intentScopeId,
        baseIntentVersionId: (await options.intentStore.getScope(intentScopeId))?.currentIntentVersionId ?? null,
        logicalUserTurnId: sourceMessage.logicalUserTurnId,
        observedMessageHorizon: sourceMessage.messageHorizon,
        sourceMessageId: sourceMessage.messageId,
        sourceDigest: sourceMessage.contentDigest,
        operations: [{
          op: "SET",
          path: { kind: "OBJECTIVE" },
          value: { state: "VALUE", value: interpretation.objective },
        }],
      };
      let intentVersionId: string;
      const existingScope = await options.intentStore.getScope(intentScopeId);
      if (!existingScope) {
        const scope = await options.intentStore.createScope({
          intentScopeId,
          kind: "consultation",
          initialTransition: transition,
        });
        intentVersionId = scope.currentIntentVersionId;
      } else {
        const applied = await options.intentStore.applyTransition(transition);
        if (!applied.resultingIntentVersionId) {
          return reply.status(409).send({ error: "INTENT_AUTHORITY_REJECTED" });
        }
        intentVersionId = applied.resultingIntentVersionId;
      }
      const requestBody = consultationRunRequestSchema.parse({
        kind: "consultation",
        objective: interpretation.objective,
        context: parsed.data.context ?? [],
        decisionNeed: "NONE",
        resourceNeed: interpretation.resourceNeed,
        sourceMessageId: sourceMessage.messageId,
        sourceMessageDigest: sourceMessage.contentDigest,
        intentVersion: sourceMessage.messageHorizon,
        intentScopeId,
        intentVersionId,
      });
      const runId = stableUuid(
        "consultation-run",
        conversationId,
        sourceMessage.messageId,
        sourceMessage.contentDigest,
      );

      const run = createPendingRun(conversationId, requestBody, runId);
      const canonicalRoute = `/api/v1/conversations/${encodeURIComponent(conversationId)}/turns`;
      const submission = await options.apiControlStore.submitRun({
        run,
        intentBinding: { intentScopeId, intentVersionId },
        dispatch: {
          logicalKey: `run:${run.id}:execute`,
          queueName: "lattice.run",
          payload: { runId: run.id, submittedVersion: run.version },
        },
        idempotency: {
          scopeKey: apiSubjectForRequest(request),
          httpMethod: "POST",
          canonicalRoute,
          idempotencyKey: `consultation:${sourceMessage.logicalUserTurnId}`,
          requestHash: createApiRequestHash({
            messageId: sourceMessage.messageId,
            contentDigest: sourceMessage.contentDigest,
            context: requestBody.context,
            resourceNeed: requestBody.resourceNeed,
          }),
          expiresAt: new Date(Date.now() + IDEMPOTENCY_RETENTION_MS),
        },
      });
      if (submission.outcome === "conflict") {
        return reply.status(409).send({ error: "CONSULTATION_IDEMPOTENCY_CONFLICT" });
      }
      return reply.status(202).send({
        status: "RUN_ACCEPTED",
        runId: submission.response.runId,
        acceptedUnderstanding: requestBody.objective,
        provenance: {
          origin: sourceMessage.origin,
          messageId: sourceMessage.messageId,
          contentDigest: sourceMessage.contentDigest,
          intentVersion: requestBody.intentVersion,
          interpretationAuthority: interpretation.authority,
        },
        intentScopeId,
        intentVersionId,
      });
    },
  );

  app.post<{ Params: { conversationId: string; proposalId: string } }>(
    "/api/v1/conversations/:conversationId/clarifications/:proposalId/confirm",
    async (request, reply) => {
      const parsed = clarificationTurnSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: "INVALID_CONSULTATION_CLARIFICATION", details: parsed.error.flatten() });
      const conversationId = request.params.conversationId.trim();
      const clarificationText = parsed.data.message ?? parsed.data.content ?? "";
      const proposal = await options.intentStore.getPendingProposal(request.params.proposalId.trim());
      if (!proposal || proposal.intentScopeId !== `consultation:${conversationId}`) return reply.status(404).send({ error: "CLARIFICATION_NOT_FOUND" });
      if (proposal.status === "STALE") return reply.status(409).send({ error: "CLARIFICATION_STALE" });
      if (!isHardRequirementConfirmation(clarificationText)) {
        return reply.status(422).send({
          error: "CLARIFICATION_NOT_REPRESENTABLE",
          message: "Confirm with yes/that's correct/hard requirement, or submit a separately supported correction; the pending proposal remains non-authoritative.",
        });
      }
      const messageId = parsed.data.messageId ?? stableUuid("consultation-message", conversationId, parsed.data.turnId);
      const sourceMessage = await options.userMessageStore.append({
        conversationId, intentScopeId: proposal.intentScopeId, logicalUserTurnId: parsed.data.turnId,
        messageId, messageHorizon: proposal.observedMessageHorizon + 1, content: clarificationText,
      });
      const confirmation = await options.intentStore.confirmPendingProposal({
        transitionId: stableUuid("consultation-material-confirm", conversationId, proposal.proposalId, sourceMessage.messageId),
        proposalId: proposal.proposalId, expectedProposalDigest: proposal.proposalDigest,
        intentScopeId: proposal.intentScopeId, baseIntentVersionId: proposal.baseIntentVersionId,
        logicalUserTurnId: sourceMessage.logicalUserTurnId, observedMessageHorizon: sourceMessage.messageHorizon,
        sourceMessageId: sourceMessage.messageId, sourceDigest: sourceMessage.contentDigest,
      });
      if (!confirmation.resultingIntentVersionId || (confirmation.disposition !== "COMMITTED" && confirmation.disposition !== "REPLAYED")) {
        return reply.status(409).send({ error: "CLARIFICATION_CONFIRMATION_REJECTED", disposition: confirmation.disposition });
      }
      const version = await options.intentStore.getVersion(confirmation.resultingIntentVersionId);
      if (!version) return reply.status(500).send({ error: "CONFIRMED_INTENT_VERSION_MISSING" });
      const bounded = deriveQualifiedLegacyBoundedRunRequest(version.state);
      const requestBody = consultationRunRequestSchema.parse({
        kind: "consultation", objective: bounded.goal, context: [], decisionNeed: "NONE", resourceNeed: "NONE",
        sourceMessageId: sourceMessage.messageId, sourceMessageDigest: sourceMessage.contentDigest,
        intentVersion: sourceMessage.messageHorizon, intentScopeId: proposal.intentScopeId, intentVersionId: version.intentVersionId,
      });
      const run = createPendingRun(conversationId, requestBody, stableUuid("consultation-material-run", conversationId, proposal.proposalId, version.intentVersionId));
      const submission = await options.apiControlStore.submitRun({
        run, intentBinding: { intentScopeId: proposal.intentScopeId, intentVersionId: version.intentVersionId },
        dispatch: { logicalKey: `run:${run.id}:execute`, queueName: "lattice.run", payload: { runId: run.id, submittedVersion: run.version } },
        idempotency: { scopeKey: apiSubjectForRequest(request), httpMethod: "POST", canonicalRoute: `/api/v1/conversations/${encodeURIComponent(conversationId)}/clarifications/${encodeURIComponent(proposal.proposalId)}/confirm`, idempotencyKey: `consultation-clarification:${parsed.data.turnId}`, requestHash: createApiRequestHash({ proposalDigest: proposal.proposalDigest, messageId: sourceMessage.messageId, contentDigest: sourceMessage.contentDigest }), expiresAt: new Date(Date.now() + IDEMPOTENCY_RETENTION_MS) },
      });
      if (submission.outcome === "conflict") return reply.status(409).send({ error: "CONSULTATION_CLARIFICATION_IDEMPOTENCY_CONFLICT" });
      return reply.status(202).send({ status: "RUN_ACCEPTED", runId: submission.response.runId, intentScopeId: proposal.intentScopeId, intentVersionId: version.intentVersionId, proposalId: proposal.proposalId });
    },
  );

  app.get<{ Params: { runId: string } }>("/api/v1/runs/:runId/outcome", async (request, reply) => {
    const run = await options.runStore.get(request.params.runId);
    if (!run) return reply.status(404).send({ error: "RUN_NOT_FOUND" });
    if (run.status === "FAILED" || run.status === "CANCELLED") {
      return reply.status(409).send({ error: "RUN_NOT_SUCCESSFUL", status: run.status });
    }
    if (run.status !== "COMPLETED") {
      return reply.status(202).send({ status: run.status });
    }
    const truth = await options.runStore.getTruthBundle(run.id);
    if (!truth) return reply.status(409).send({ error: "VALIDATED_TRUTH_NOT_AVAILABLE" });
    return reply.send({ runId: run.id, status: run.status, outcome: buildRunOutcome(run, truth) });
  });
}
