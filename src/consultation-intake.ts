import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { createApiRequestHash, type ApiRunControlStore } from "./api-control-store.js";
import { consultationRunRequestSchema } from "./domain.js";
import {
  ConservativeConsultationInterpreter,
  clarificationForDecision,
  deriveDecisionNeed,
  isBroadConfirmation,
  type ConsultationInterpreter,
} from "./intent/consultation-interpretation.js";
import type { IntentAuthorityStore } from "./intent/store.js";
import type { IntentUserMessage, IntentUserMessageStore } from "./intent/source-message-store.js";
import type { IntentOperation, IntentState, IntentVersion, PendingIntentProposal } from "./intent/types.js";
import { buildRunOutcome } from "./outcome.js";
import { createPendingRun } from "./run-execution.js";
import type { RunStore } from "./run-store.js";

const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1_000;

const consultationTurnSchema = z.object({
  turnId: z.string().min(1).max(200),
  message: z.string().min(1).max(8_000).refine((value) => value.trim().length > 0, "message must not be blank"),
  context: z.array(z.string().min(1).max(4_000)).max(32).optional(),
  prepare: z.enum(["CHECKLIST", "PREPARED_MESSAGE"]).optional(),
}).strict();

export interface ConsultationIntakeOptions {
  userMessageStore: IntentUserMessageStore;
  intentAuthorityStore: IntentAuthorityStore;
  apiControlStore: ApiRunControlStore;
  runStore: RunStore;
  interpreter?: ConsultationInterpreter;
  apiSubject?: string | ((request: FastifyRequest) => string);
}

function digestHex(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\u001f")).digest("hex");
}

function stableUuid(...parts: string[]): `${string}-${string}-${string}-${string}-${string}` {
  const digest = digestHex(...parts).slice(0, 32);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
}

function valueOf(field: IntentState["objective"]): string | null {
  return field?.value.state === "VALUE" && typeof field.value.value === "string" ? field.value.value : null;
}

function authoritativeContext(state: IntentState): string[] {
  return [...Object.entries(state.requirements), ...Object.entries(state.preferences)]
    .filter(([key]) => !key.startsWith("decision."))
    .flatMap(([, field]) => field.value.state === "VALUE" ? [String(field.value.value)] : []);
}

function hasDecisionSemantics(state: IntentState): boolean {
  return Object.keys(state.requirements).some((key) => key.startsWith("decision."))
    || Object.keys(state.preferences).some((key) => key.startsWith("decision."));
}

function noopObjectiveOperation(state: IntentState): IntentOperation {
  const objective = valueOf(state.objective);
  if (!objective) throw new Error("Consultation IntentVersion has no authoritative objective.");
  return { op: "NO_CHANGE", path: { kind: "OBJECTIVE" } };
}

async function findPendingProposals(
  intentAuthorityStore: IntentAuthorityStore,
  intentScopeId: string,
  messages: readonly IntentUserMessage[],
): Promise<PendingIntentProposal[]> {
  const pending: PendingIntentProposal[] = [];
  for (const message of messages) {
    if (message.intentScopeId !== intentScopeId) continue;
    const proposal = await intentAuthorityStore.getPendingProposal(
      stableUuid("consultation-proposal", intentScopeId, message.messageId),
    );
    if (proposal?.status === "PENDING") pending.push(proposal);
  }
  return pending;
}

async function currentVersion(store: IntentAuthorityStore, intentScopeId: string): Promise<IntentVersion | undefined> {
  const scope = await store.getScope(intentScopeId);
  if (!scope) return undefined;
  const version = await store.getVersion(scope.currentIntentVersionId);
  if (!version) throw new Error("Intent Authority scope points to a missing IntentVersion.");
  return version;
}

async function findLatestObjectiveVersion(
  store: IntentAuthorityStore,
  start: IntentVersion,
): Promise<IntentVersion> {
  let cursor = start;
  while (cursor.predecessorIntentVersionId) {
    const predecessor = await store.getVersion(cursor.predecessorIntentVersionId);
    if (!predecessor) break;
    if (valueOf(predecessor.state.objective) !== valueOf(cursor.state.objective)) return cursor;
    cursor = predecessor;
  }
  return cursor;
}

function isObjectiveCorrection(message: string, operations: readonly IntentOperation[]): boolean {
  return /^(?:actually|correction:|i meant)\b/i.test(message.trim())
    && operations.length === 1
    && operations[0]?.op === "SET"
    && operations[0].path.kind === "OBJECTIVE";
}

async function commitExplicitMeaning(
  store: IntentAuthorityStore,
  intentScopeId: string,
  sourceMessage: IntentUserMessage,
  operations: readonly IntentOperation[],
): Promise<IntentVersion> {
  const existing = await currentVersion(store, intentScopeId);
  if (!existing) {
    const semanticOperations = operations.filter((operation) => operation.op !== "NO_CHANGE");
    if (semanticOperations.length === 0) throw new Error("Initial consultation turn did not establish an objective.");
    const scope = await store.createScope({
      intentScopeId,
      kind: "consultation",
      initialTransition: {
        transitionId: stableUuid("consultation-intent", intentScopeId, sourceMessage.logicalUserTurnId),
        intentScopeId,
        baseIntentVersionId: null,
        logicalUserTurnId: sourceMessage.logicalUserTurnId,
        observedMessageHorizon: sourceMessage.messageHorizon,
        sourceMessageId: sourceMessage.messageId,
        sourceDigest: sourceMessage.contentDigest,
        operations: [...semanticOperations],
      },
    });
    const version = await store.getVersion(scope.currentIntentVersionId);
    if (!version) throw new Error("Intent Authority did not materialize the initial IntentVersion.");
    return version;
  }

  const effectiveOperations = operations.length > 0 ? [...operations] : [noopObjectiveOperation(existing.state)];
  const transitionId = stableUuid("consultation-intent", intentScopeId, sourceMessage.logicalUserTurnId);
  const result = isObjectiveCorrection(sourceMessage.content, effectiveOperations)
    ? await (async () => {
        const target = await findLatestObjectiveVersion(store, existing);
        return store.applyCorrection({
          transitionId,
          intentScopeId,
          baseIntentVersionId: existing.intentVersionId,
          correctsIntentVersionId: target.intentVersionId,
          logicalUserTurnId: sourceMessage.logicalUserTurnId,
          observedMessageHorizon: sourceMessage.messageHorizon,
          sourceMessageId: sourceMessage.messageId,
          sourceDigest: sourceMessage.contentDigest,
          operations: effectiveOperations,
        });
      })()
    : await store.applyTransition({
        transitionId,
        intentScopeId,
        baseIntentVersionId: existing.intentVersionId,
        logicalUserTurnId: sourceMessage.logicalUserTurnId,
        observedMessageHorizon: sourceMessage.messageHorizon,
        sourceMessageId: sourceMessage.messageId,
        sourceDigest: sourceMessage.contentDigest,
        operations: effectiveOperations,
      });

  if (!result.resultingIntentVersionId) {
    throw new Error(`Intent Authority rejected consultation meaning: ${result.disposition}.`);
  }
  const version = await store.getVersion(result.resultingIntentVersionId);
  if (!version) throw new Error("Intent Authority transition returned a missing IntentVersion.");
  return version;
}

async function supersedePriorPending(
  store: IntentAuthorityStore,
  sourceMessage: IntentUserMessage,
  proposals: readonly PendingIntentProposal[],
): Promise<void> {
  for (const proposal of proposals) {
    await store.confirmPendingProposal({
      transitionId: stableUuid("consultation-stale-proposal", proposal.proposalId, sourceMessage.messageId),
      proposalId: proposal.proposalId,
      expectedProposalDigest: proposal.proposalDigest,
      intentScopeId: proposal.intentScopeId,
      baseIntentVersionId: proposal.baseIntentVersionId,
      logicalUserTurnId: `${sourceMessage.logicalUserTurnId}:supersede:${proposal.proposalId}`,
      observedMessageHorizon: sourceMessage.messageHorizon,
      sourceMessageId: sourceMessage.messageId,
      sourceDigest: sourceMessage.contentDigest,
    });
  }
}

function clarificationResponse(
  sourceMessage: IntentUserMessage,
  version: IntentVersion | undefined,
  clarification: string,
  pending: readonly PendingIntentProposal[] = [],
) {
  return {
    status: "CLARIFICATION_REQUIRED" as const,
    acceptedUnderstanding: version ? valueOf(version.state.objective) : null,
    clarification,
    intent: version ? {
      scopeId: version.intentScopeId,
      versionId: version.intentVersionId,
      version: version.version,
    } : null,
    pendingInterpretation: pending.length === 1 ? {
      proposalId: pending[0]!.proposalId,
      proposalDigest: pending[0]!.proposalDigest,
      propositionCount: pending[0]!.operations.length,
    } : null,
    provenance: {
      origin: sourceMessage.origin,
      messageId: sourceMessage.messageId,
      contentDigest: sourceMessage.contentDigest,
    },
  };
}

export function registerConsultationIntake(app: FastifyInstance, options: ConsultationIntakeOptions): void {
  const interpreter = options.interpreter ?? new ConservativeConsultationInterpreter();
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
      const existingMessage = await options.userMessageStore.get(messageId);
      const beforeHistory = await options.userMessageStore.listByConversation(conversationId);
      const messageHorizon = existingMessage?.messageHorizon
        ?? Math.max(0, ...beforeHistory.map((message) => message.messageHorizon)) + 1;

      let sourceMessage: IntentUserMessage;
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

      const authorityBefore = await currentVersion(options.intentAuthorityStore, intentScopeId);
      const pendingBefore = await findPendingProposals(options.intentAuthorityStore, intentScopeId, beforeHistory);

      if (isBroadConfirmation(sourceMessage.content)) {
        if (pendingBefore.length !== 1 || pendingBefore[0]!.operations.length !== 1) {
          return reply.status(200).send(clarificationResponse(
            sourceMessage,
            authorityBefore,
            pendingBefore.length > 1
              ? "Please state which proposed interpretation you mean."
              : "Please state the meaning you want me to confirm.",
            pendingBefore,
          ));
        }
        const proposal = pendingBefore[0]!;
        const result = await options.intentAuthorityStore.confirmPendingProposal({
          transitionId: stableUuid("consultation-confirm", proposal.proposalId, sourceMessage.messageId),
          proposalId: proposal.proposalId,
          expectedProposalDigest: proposal.proposalDigest,
          intentScopeId,
          baseIntentVersionId: proposal.baseIntentVersionId,
          logicalUserTurnId: sourceMessage.logicalUserTurnId,
          observedMessageHorizon: sourceMessage.messageHorizon,
          sourceMessageId: sourceMessage.messageId,
          sourceDigest: sourceMessage.contentDigest,
        });
        if (!result.resultingIntentVersionId) {
          return reply.status(409).send({ error: "STALE_INTERPRETATION", disposition: result.disposition });
        }
      }

      let exactVersion = await currentVersion(options.intentAuthorityStore, intentScopeId);
      let interpretation = await interpreter.propose({
        message: sourceMessage.content,
        context: parsed.data.context ?? [],
        prepare: parsed.data.prepare,
        currentIntentState: exactVersion?.state ?? null,
      });

      if (!isBroadConfirmation(sourceMessage.content)) {
        exactVersion = await commitExplicitMeaning(
          options.intentAuthorityStore,
          intentScopeId,
          sourceMessage,
          interpretation.explicitOperations,
        );
        if (pendingBefore.length > 0) {
          await supersedePriorPending(options.intentAuthorityStore, sourceMessage, pendingBefore);
        }
      } else {
        exactVersion = await currentVersion(options.intentAuthorityStore, intentScopeId);
        interpretation = { ...interpretation, inferredMaterialOperations: [], possibleDecision: exactVersion ? hasDecisionSemantics(exactVersion.state) : false };
      }

      if (!exactVersion) throw new Error("Consultation Intent Authority did not produce an exact IntentVersion.");

      if (interpretation.inferredMaterialOperations.length > 0) {
        const proposal = await options.intentAuthorityStore.createPendingProposal({
          proposalId: stableUuid("consultation-proposal", intentScopeId, sourceMessage.messageId),
          intentScopeId,
          baseIntentVersionId: exactVersion.intentVersionId,
          observedMessageHorizon: sourceMessage.messageHorizon,
          sourceMessageId: sourceMessage.messageId,
          sourceDigest: sourceMessage.contentDigest,
          operations: interpretation.inferredMaterialOperations,
          materiality: "MATERIAL",
        });
        return reply.status(200).send(clarificationResponse(
          sourceMessage,
          exactVersion,
          proposal.operations.length === 1
            ? "I inferred one material point. Is that what you mean?"
            : "I inferred several material points. Please confirm or correct them explicitly.",
          [proposal],
        ));
      }

      const possibleDecision = interpretation.possibleDecision || hasDecisionSemantics(exactVersion.state);
      const decisionNeed = deriveDecisionNeed(exactVersion.state, possibleDecision);
      if (decisionNeed === "UNRESOLVED") {
        return reply.status(200).send(clarificationResponse(
          sourceMessage,
          exactVersion,
          clarificationForDecision(exactVersion.state, true) ?? "Please clarify the decision meaning that should govern this choice.",
        ));
      }

      const objective = valueOf(exactVersion.state.objective);
      if (!objective) {
        return reply.status(200).send(clarificationResponse(sourceMessage, exactVersion, "What are you trying to accomplish?"));
      }

      const requestBody = consultationRunRequestSchema.parse({
        kind: "consultation",
        objective,
        context: authoritativeContext(exactVersion.state),
        decisionNeed,
        resourceNeed: interpretation.resourceNeed,
        sourceMessageId: sourceMessage.messageId,
        sourceMessageDigest: sourceMessage.contentDigest,
        intentScopeId,
        intentVersionId: exactVersion.intentVersionId,
        intentVersionNumber: exactVersion.version,
        intentState: exactVersion.state,
        assumptions: interpretation.assumptions,
      });
      const runId = stableUuid("consultation-run", conversationId, exactVersion.intentVersionId, sourceMessage.messageId);
      const run = createPendingRun(conversationId, requestBody, runId);
      const canonicalRoute = `/api/v1/conversations/${encodeURIComponent(conversationId)}/turns`;
      const submission = await options.apiControlStore.submitRun({
        run,
        intentBinding: { intentScopeId, intentVersionId: exactVersion.intentVersionId },
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
            intentVersionId: exactVersion.intentVersionId,
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
        acceptedUnderstanding: objective,
        decisionNeed,
        intent: { scopeId: intentScopeId, versionId: exactVersion.intentVersionId, version: exactVersion.version },
        provenance: {
          origin: sourceMessage.origin,
          messageId: sourceMessage.messageId,
          contentDigest: sourceMessage.contentDigest,
          interpretationAuthority: "INTENT_AUTHORITY",
        },
      });
    },
  );

  app.get<{ Params: { runId: string } }>("/api/v1/runs/:runId/outcome", async (request, reply) => {
    const run = await options.runStore.get(request.params.runId);
    if (!run) return reply.status(404).send({ error: "RUN_NOT_FOUND" });
    if (run.status === "FAILED" || run.status === "CANCELLED") {
      return reply.status(409).send({ error: "RUN_NOT_SUCCESSFUL", status: run.status });
    }
    if (run.status !== "COMPLETED") return reply.status(202).send({ status: run.status });
    const truth = await options.runStore.getTruthBundle(run.id);
    if (!truth) return reply.status(409).send({ error: "VALIDATED_TRUTH_NOT_AVAILABLE" });
    return reply.send({ runId: run.id, status: run.status, outcome: buildRunOutcome(run, truth) });
  });
}
