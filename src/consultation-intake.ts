import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { createApiRequestHash, type ApiRunControlStore } from "./api-control-store.js";
import type { ConversationStore } from "./conversation/conversation-store.js";
import type { QualifiedCriterionCatalog } from "./decision/criterion-catalog.js";
import type { DecisionInputSnapshot } from "./decision/decision-input-snapshot.js";
import {
  consultationRunRequestSchema,
  type ConsultationRunRequest,
} from "./domain.js";
import {
  ConservativeConsultationInterpreter,
  type ConsultationInterpretationProposal,
  type ConsultationInterpreter,
  type ConsultationResourceNeed,
} from "./intent/consultation-interpreter.js";
import { buildDecisionInputFromGeneralizedIntent } from "./intent/generalized-decision-planning.js";
import { deriveGeneralizedDecisionIntentFromState } from "./intent/generalized-decision-projection.js";
import type { IntentUserMessage, IntentUserMessageStore } from "./intent/source-message-store.js";
import type { IntentAuthorityStore } from "./intent/store.js";
import type {
  IntentOperation,
  CreatePendingIntentProposalInput,
  IntentTransitionCommand,
  IntentVersion,
  PendingIntentProposal,
} from "./intent/types.js";
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
  conversationStore: ConversationStore;
  userMessageStore: IntentUserMessageStore;
  apiControlStore: ApiRunControlStore;
  runStore: RunStore;
  interpreter?: ConsultationInterpreter;
  criterionCatalog?: QualifiedCriterionCatalog;
  apiSubject?: string | ((request: FastifyRequest) => string);
}

function digestHex(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\u001f")).digest("hex");
}

function stableUuid(...parts: string[]): `${string}-${string}-${string}-${string}-${string}` {
  const digest = digestHex(...parts).slice(0, 32);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
}

function isConfirmation(message: string): boolean {
  return /^(?:yes|yes please|yes,? (?:that'?s|that is) (?:right|correct)|confirmed|confirm|that'?s right|that'?s correct|correct|apply it|use that)\.?$/iu
    .test(message.trim().replace(/\s+/g, " "));
}

function validateProposedOperations(
  operations: readonly IntentOperation[],
): CreatePendingIntentProposalInput["operations"] {
  if (operations.length === 0) {
    throw new Error("Material clarification must propose at least one semantic operation.");
  }
  const validated = operations.map((operation) => {
    if (operation.op === "NO_CHANGE" || operation.path.kind === "OBJECTIVE") {
      throw new Error("Interpretation proposals may only contain material requirement or preference changes.");
    }
    return structuredClone(operation);
  });
  return validated as CreatePendingIntentProposalInput["operations"];
}

function qualifiedDecisionNeed(
  version: IntentVersion,
  criterionCatalog: QualifiedCriterionCatalog | undefined,
): { decisionNeed: "UNRESOLVED" } | { decisionNeed: "QUALIFIED"; decisionInput: DecisionInputSnapshot } {
  if (!criterionCatalog) return { decisionNeed: "UNRESOLVED" };
  try {
    const intent = deriveGeneralizedDecisionIntentFromState(
      version.intentScopeId,
      version.intentVersionId,
      version.state,
    );
    const decisionInput = buildDecisionInputFromGeneralizedIntent(intent, criterionCatalog);
    if (decisionInput.hardRequirements.length === 0 && decisionInput.priorities.length === 0) {
      return { decisionNeed: "UNRESOLVED" };
    }
    return { decisionNeed: "QUALIFIED", decisionInput };
  } catch {
    return { decisionNeed: "UNRESOLVED" };
  }
}

function consultationRequest(input: {
  objective: string;
  context: readonly string[];
  decisionNeed: "NONE" | "UNRESOLVED" | "QUALIFIED";
  resourceNeed: ConsultationResourceNeed;
  sourceMessageId: string;
  sourceMessageDigest: string;
  intentScopeId: string;
  intentVersion: IntentVersion;
  decisionInput?: DecisionInputSnapshot;
}): ConsultationRunRequest {
  return consultationRunRequestSchema.parse({
    kind: "consultation",
    objective: input.objective,
    context: [...input.context],
    decisionNeed: input.decisionNeed,
    resourceNeed: input.resourceNeed,
    sourceMessageId: input.sourceMessageId,
    sourceMessageDigest: input.sourceMessageDigest,
    intentVersion: input.intentVersion.version,
    intentScopeId: input.intentScopeId,
    intentVersionId: input.intentVersion.intentVersionId,
    ...(input.decisionInput ? { decisionInput: input.decisionInput } : {}),
  });
}

function authoritativeObjective(version: IntentVersion): string {
  const field = version.state.objective;
  if (!field || field.value.state !== "VALUE" || typeof field.value.value !== "string") {
    throw new Error("Authoritative consultation objective is missing.");
  }
  return field.value.value;
}

async function submitConsultationRun(input: {
  request: FastifyRequest;
  options: ConsultationIntakeOptions;
  apiSubjectForRequest: (request: FastifyRequest) => string;
  conversationId: string;
  turnId: string;
  runPurpose: string;
  requestBody: ConsultationRunRequest;
  intentScopeId: string;
  intentVersionId: string;
  canonicalRoute: string;
  idempotencyMaterial: Record<string, unknown>;
}): Promise<{ outcome: "created" | "existing"; runId: string } | { outcome: "conflict" }> {
  const run = createPendingRun(
    input.conversationId,
    input.requestBody,
    stableUuid(input.runPurpose, input.conversationId, input.turnId, input.intentVersionId),
  );
  const submission = await input.options.apiControlStore.submitRun({
    run,
    intentBinding: {
      intentScopeId: input.intentScopeId,
      intentVersionId: input.intentVersionId,
    },
    dispatch: {
      logicalKey: `run:${run.id}:execute`,
      queueName: "lattice.run",
      payload: { runId: run.id, submittedVersion: run.version },
    },
    idempotency: {
      scopeKey: input.apiSubjectForRequest(input.request),
      httpMethod: "POST",
      canonicalRoute: input.canonicalRoute,
      idempotencyKey: `consultation:${input.turnId}`,
      requestHash: createApiRequestHash(input.idempotencyMaterial),
      expiresAt: new Date(Date.now() + IDEMPOTENCY_RETENTION_MS),
    },
  });
  if (submission.outcome === "conflict") return { outcome: "conflict" };
  return { outcome: submission.outcome, runId: submission.response.runId };
}

async function createPendingClarification(input: {
  options: ConsultationIntakeOptions;
  conversationId: string;
  intentScopeId: string;
  version: IntentVersion;
  sourceMessage: Awaited<ReturnType<IntentUserMessageStore["append"]>>;
  operations: readonly IntentOperation[];
}): Promise<PendingIntentProposal> {
  const operations = validateProposedOperations(input.operations);
  return input.options.intentStore.createPendingProposal({
    proposalId: stableUuid(
      "consultation-material-proposal",
      input.conversationId,
      input.version.intentVersionId,
      input.sourceMessage.contentDigest,
      JSON.stringify(operations),
    ),
    intentScopeId: input.intentScopeId,
    baseIntentVersionId: input.version.intentVersionId,
    observedMessageHorizon: input.sourceMessage.messageHorizon,
    sourceMessageId: input.sourceMessage.messageId,
    sourceDigest: input.sourceMessage.contentDigest,
    operations,
    materiality: "MATERIAL",
  });
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
      if (!await options.conversationStore.getOwned(conversationId, apiSubjectForRequest(request))) {
        return reply.status(404).send({ error: "CONVERSATION_NOT_FOUND" });
      }

      const intentScopeId = `consultation:${conversationId}`;
      const messageId = stableUuid("consultation-message", conversationId, parsed.data.turnId);
      const existing = await options.userMessageStore.get(messageId);
      const history = existing ? [] : await options.userMessageStore.listByConversation(conversationId);
      const messageHorizon = existing?.messageHorizon
        ?? Math.max(0, ...history.map((message) => message.messageHorizon)) + 1;

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

      const existingScope = await options.intentStore.getScope(intentScopeId);
      const currentVersion = existingScope
        ? await options.intentStore.getVersion(existingScope.currentIntentVersionId)
        : undefined;
      if (existingScope && !currentVersion) {
        return reply.status(500).send({ error: "AUTHORITATIVE_INTENT_VERSION_MISSING" });
      }

      let interpretation: ConsultationInterpretationProposal;
      try {
        interpretation = await interpreter.interpret({
          message: sourceMessage.content,
          context: parsed.data.context ?? [],
          ...(currentVersion ? { currentIntentVersion: currentVersion } : {}),
          ...(parsed.data.prepare ? { explicitResourceNeed: parsed.data.prepare } : {}),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Consultation interpretation failed.";
        return reply.status(422).send({ error: "CONSULTATION_INTERPRETATION_FAILED", message });
      }
      if (
        interpretation.objectiveEffect.kind !== "PRESERVE"
        && interpretation.objectiveEffect.value.trim().length === 0
      ) {
        return reply.status(422).send({
          error: "INVALID_OBJECTIVE_EFFECT",
          message: "An explicit objective effect must contain non-empty USER meaning.",
        });
      }
      if (interpretation.materialClarification && !interpretation.decisionRequested) {
        return reply.status(422).send({
          error: "INCONSISTENT_INTERPRETATION_PROPOSAL",
          message: "Material decision semantics require an unresolved decision need.",
        });
      }

      if (!existingScope && interpretation.objectiveEffect.kind !== "ESTABLISH") {
        return reply.status(422).send({
          error: "INITIAL_OBJECTIVE_REQUIRED",
          message: "The first consultation turn must establish an explicit objective.",
        });
      }
      if (existingScope && interpretation.objectiveEffect.kind === "ESTABLISH") {
        return reply.status(422).send({
          error: "OBJECTIVE_ALREADY_ESTABLISHED",
          message: "A later turn must preserve or explicitly replace the current objective.",
        });
      }

      const objectiveOperation: IntentOperation = {
        op: "SET",
        path: { kind: "OBJECTIVE" },
        value: {
          state: "VALUE",
          value: interpretation.objectiveEffect.kind === "PRESERVE"
            ? authoritativeObjective(currentVersion!)
            : interpretation.objectiveEffect.value.trim(),
        },
      };
      const transition: IntentTransitionCommand = {
        transitionId: stableUuid("consultation-transition", conversationId, sourceMessage.messageId),
        intentScopeId,
        baseIntentVersionId: existingScope?.currentIntentVersionId ?? null,
        logicalUserTurnId: sourceMessage.logicalUserTurnId,
        observedMessageHorizon: sourceMessage.messageHorizon,
        sourceMessageId: sourceMessage.messageId,
        sourceDigest: sourceMessage.contentDigest,
        operations: [objectiveOperation],
      };

      let intentVersionId: string;
      if (!existingScope) {
        const scope = await options.intentStore.createScope({
          intentScopeId,
          kind: "consultation",
          initialTransition: transition,
        });
        intentVersionId = scope.currentIntentVersionId;
      } else if (interpretation.objectiveEffect.kind === "PRESERVE") {
        intentVersionId = existingScope.currentIntentVersionId;
      } else {
        const applied = await options.intentStore.applyTransition(transition);
        if (!applied.resultingIntentVersionId) {
          return reply.status(409).send({ error: "INTENT_AUTHORITY_REJECTED" });
        }
        intentVersionId = applied.resultingIntentVersionId;
      }
      const version = await options.intentStore.getVersion(intentVersionId);
      if (!version) return reply.status(500).send({ error: "AUTHORITATIVE_INTENT_VERSION_MISSING" });

      if (interpretation.materialClarification) {
        let proposal: PendingIntentProposal;
        try {
          proposal = await createPendingClarification({
            options,
            conversationId,
            intentScopeId,
            version,
            sourceMessage,
            operations: interpretation.materialClarification.operations,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Material clarification proposal failed.";
          return reply.status(422).send({ error: "INVALID_MATERIAL_INTERPRETATION_PROPOSAL", message });
        }
        return reply.status(202).send({
          status: "NEEDS_CLARIFICATION",
          decisionNeed: "UNRESOLVED",
          acceptedUnderstanding: authoritativeObjective(version),
          intentScopeId,
          intentVersionId: version.intentVersionId,
          proposalId: proposal.proposalId,
          proposalDigest: proposal.proposalDigest,
          question: interpretation.materialClarification.question,
          confirmationExample: interpretation.materialClarification.confirmationExample,
        });
      }

      const qualification = interpretation.decisionRequested
        ? qualifiedDecisionNeed(version, options.criterionCatalog)
        : { decisionNeed: "NONE" as const };
      const requestBody = consultationRequest({
        objective: authoritativeObjective(version),
        context: [],
        decisionNeed: qualification.decisionNeed,
        resourceNeed: interpretation.resourceNeed,
        sourceMessageId: sourceMessage.messageId,
        sourceMessageDigest: sourceMessage.contentDigest,
        intentScopeId,
        intentVersion: version,
        ...(qualification.decisionNeed === "QUALIFIED" ? { decisionInput: qualification.decisionInput } : {}),
      });
      const submission = await submitConsultationRun({
        request,
        options,
        apiSubjectForRequest,
        conversationId,
        turnId: sourceMessage.logicalUserTurnId,
        runPurpose: "consultation-run",
        requestBody,
        intentScopeId,
        intentVersionId: version.intentVersionId,
        canonicalRoute: `/api/v1/conversations/${encodeURIComponent(conversationId)}/turns`,
        idempotencyMaterial: {
          messageId: sourceMessage.messageId,
          contentDigest: sourceMessage.contentDigest,
          context: requestBody.context,
          decisionNeed: requestBody.decisionNeed,
          resourceNeed: requestBody.resourceNeed,
        },
      });
      if (submission.outcome === "conflict") {
        return reply.status(409).send({ error: "CONSULTATION_IDEMPOTENCY_CONFLICT" });
      }
      return reply.status(202).send({
        status: "RUN_ACCEPTED",
        runId: submission.runId,
        acceptedUnderstanding: requestBody.objective,
        decisionNeed: requestBody.decisionNeed,
        provenance: {
          origin: sourceMessage.origin,
          messageId: sourceMessage.messageId,
          contentDigest: sourceMessage.contentDigest,
          intentVersion: version.version,
          interpretationAuthority: "NON_AUTHORITATIVE_PROPOSAL",
        },
        intentScopeId,
        intentVersionId: version.intentVersionId,
      });
    },
  );

  app.post<{ Params: { conversationId: string; proposalId: string } }>(
    "/api/v1/conversations/:conversationId/clarifications/:proposalId/confirm",
    async (request, reply) => {
      const parsed = clarificationTurnSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "INVALID_CONSULTATION_CLARIFICATION", details: parsed.error.flatten() });
      }
      const conversationId = request.params.conversationId.trim();
      if (!await options.conversationStore.getOwned(conversationId, apiSubjectForRequest(request))) {
        return reply.status(404).send({ error: "CONVERSATION_NOT_FOUND" });
      }
      const clarificationText = parsed.data.message ?? parsed.data.content ?? "";
      const proposal = await options.intentStore.getPendingProposal(request.params.proposalId.trim());
      if (!proposal || proposal.intentScopeId !== `consultation:${conversationId}`) {
        return reply.status(404).send({ error: "CLARIFICATION_NOT_FOUND" });
      }
      if (proposal.status === "STALE") return reply.status(409).send({ error: "CLARIFICATION_STALE" });
      if (!isConfirmation(clarificationText)) {
        return reply.status(422).send({
          error: "CLARIFICATION_NOT_REPRESENTABLE",
          message: "Explicitly confirm the pending interpretation or submit a new consultation turn; it remains non-authoritative.",
        });
      }

      const messageId = parsed.data.messageId
        ?? stableUuid("consultation-message", conversationId, parsed.data.turnId);
      let sourceMessage: IntentUserMessage;
      try {
        sourceMessage = await options.userMessageStore.append({
          conversationId,
          intentScopeId: proposal.intentScopeId,
          logicalUserTurnId: parsed.data.turnId,
          messageId,
          messageHorizon: proposal.observedMessageHorizon + 1,
          content: clarificationText,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Clarification provenance conflict.";
        return reply.status(409).send({ error: "CLARIFICATION_PROVENANCE_CONFLICT", message });
      }

      const confirmation = await options.intentStore.confirmPendingProposal({
        transitionId: stableUuid(
          "consultation-material-confirm",
          conversationId,
          proposal.proposalId,
          sourceMessage.messageId,
        ),
        proposalId: proposal.proposalId,
        expectedProposalDigest: proposal.proposalDigest,
        intentScopeId: proposal.intentScopeId,
        baseIntentVersionId: proposal.baseIntentVersionId,
        logicalUserTurnId: sourceMessage.logicalUserTurnId,
        observedMessageHorizon: sourceMessage.messageHorizon,
        sourceMessageId: sourceMessage.messageId,
        sourceDigest: sourceMessage.contentDigest,
      });
      if (
        !confirmation.resultingIntentVersionId
        || (confirmation.disposition !== "COMMITTED" && confirmation.disposition !== "REPLAYED")
      ) {
        return reply.status(409).send({
          error: "CLARIFICATION_CONFIRMATION_REJECTED",
          disposition: confirmation.disposition,
        });
      }
      const version = await options.intentStore.getVersion(confirmation.resultingIntentVersionId);
      if (!version) return reply.status(500).send({ error: "CONFIRMED_INTENT_VERSION_MISSING" });

      const qualification = qualifiedDecisionNeed(version, options.criterionCatalog);
      const decisionNeed = qualification.decisionNeed;
      const objectiveField = version.state.objective;
      if (
        !objectiveField
        || objectiveField.value.state !== "VALUE"
        || typeof objectiveField.value.value !== "string"
      ) {
        return reply.status(500).send({ error: "CONFIRMED_INTENT_OBJECTIVE_MISSING" });
      }
      const objective = objectiveField.value.value;
      const requestBody = consultationRequest({
        objective,
        context: [],
        decisionNeed,
        resourceNeed: "NONE",
        sourceMessageId: sourceMessage.messageId,
        sourceMessageDigest: sourceMessage.contentDigest,
        intentScopeId: proposal.intentScopeId,
        intentVersion: version,
        ...(qualification.decisionNeed === "QUALIFIED" ? { decisionInput: qualification.decisionInput } : {}),
      });
      const submission = await submitConsultationRun({
        request,
        options,
        apiSubjectForRequest,
        conversationId,
        turnId: parsed.data.turnId,
        runPurpose: "consultation-clarified-run",
        requestBody,
        intentScopeId: proposal.intentScopeId,
        intentVersionId: version.intentVersionId,
        canonicalRoute: `/api/v1/conversations/${encodeURIComponent(conversationId)}/clarifications/${encodeURIComponent(proposal.proposalId)}/confirm`,
        idempotencyMaterial: {
          proposalId: proposal.proposalId,
          proposalDigest: proposal.proposalDigest,
          messageId: sourceMessage.messageId,
          contentDigest: sourceMessage.contentDigest,
          decisionNeed,
        },
      });
      if (submission.outcome === "conflict") {
        return reply.status(409).send({ error: "CONSULTATION_CLARIFICATION_IDEMPOTENCY_CONFLICT" });
      }
      return reply.status(202).send({
        status: "RUN_ACCEPTED",
        runId: submission.runId,
        acceptedUnderstanding: objective,
        decisionNeed,
        intentScopeId: proposal.intentScopeId,
        intentVersionId: version.intentVersionId,
        proposalId: proposal.proposalId,
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
