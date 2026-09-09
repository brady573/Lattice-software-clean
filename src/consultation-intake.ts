import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { createApiRequestHash, type ApiRunControlStore } from "./api-control-store.js";
import {
  buildPreparedResourceRecord,
  preparedResourceFromRecord,
  type PreparedResourceStore,
} from "./action-preparation/prepared-resource-store.js";
import { registeredCapabilityBrokerFor } from "./capabilities/api.js";
import {
  CapabilityNotAuthorizedError,
  CapabilityRevokedError,
  CapabilityUnavailableError,
} from "./capabilities/broker.js";
import {
  USER_AUTHORIZED_MODEL_CAPABILITY_ID,
  type UserModelInput,
  type UserModelOutput,
} from "./capabilities/user-model-capability.js";
import type { ConversationStore } from "./conversation/conversation-store.js";
import { buildAcceptedChoiceRecord, type AcceptedChoiceStore } from "./intent/accepted-choice-store.js";
import type { QualifiedCriterionCatalog } from "./decision/criterion-catalog.js";
import type { DecisionInputSnapshot } from "./decision/decision-input-snapshot.js";
import {
  consultationRunRequestSchema,
  isConsultationRunRequest,
  type ConsultationRunRequest,
  type LatticeRun,
} from "./domain.js";
import {
  ConservativeConsultationInterpreter,
  inferConsultationResourceNeed,
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
import {
  establishKnowledge,
  governedKnowledgeContext,
  loadKnowledge,
  recentGovernedKnowledge,
  referenceKnowledge,
  renderHistoricalSources,
} from "./knowledge/knowledge-continuity.js";
import type { KnowledgeRecordStore } from "./knowledge/knowledge-record-store.js";
import { buildRunOutcome } from "./outcome.js";
import {
  advisoryKnowledge,
  establishRecommendation,
  establishConversationalRecommendation,
  loadRecommendation,
  loadRecommendationByRunId,
  recommendationBasisTrace,
  recommendationContext,
  renderHistoricalRecommendationExplanation,
  renderHistoricalRecommendationSources,
  renderRecommendation,
} from "./recommendation/recommendation-continuity.js";
import { recommendationOption, recommendationOptions } from "./recommendation/recommendation-options.js";
import type { RecommendationStore } from "./recommendation/recommendation-store.js";
import { createPendingRun } from "./run-execution.js";
import type { RunStore } from "./run-store.js";
import type { SolandraAdvisoryRuntime } from "./solandra/advisory.js";
import type { SolandraActionPreparer } from "./solandra/action-preparer.js";
import type {
  SolandraCognitionResult,
  SolandraCognitiveRuntime,
  SolandraRequestedHelp,
} from "./solandra/cognition.js";
import type { SolandraKnowledgePresenter } from "./solandra/knowledge-presenter.js";

const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1_000;
const MAX_RUN_CONTEXT_ITEMS = 32;
const MAX_COGNITIVE_HISTORY_ITEMS = 8;
const MAX_ADVISORY_KNOWLEDGE_ROUNDS = 2;

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
  knowledgeStore?: KnowledgeRecordStore;
  recommendationStore?: RecommendationStore;
  acceptedChoiceStore?: AcceptedChoiceStore;
  preparedResourceStore?: PreparedResourceStore;
  solandraCognition?: SolandraCognitiveRuntime;
  solandraAdvisory?: SolandraAdvisoryRuntime;
  solandraActionPreparer?: SolandraActionPreparer;
  solandraKnowledgePresenter?: SolandraKnowledgePresenter;
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
    if (operation.op === "NO_CHANGE") {
      throw new Error("Material interpretation proposals cannot contain NO_CHANGE operations.");
    }
    if (operation.path.kind === "OBJECTIVE") {
      if (
        operation.op !== "SET"
        || operation.value.state !== "VALUE"
        || typeof operation.value.value !== "string"
        || operation.value.value.trim().length === 0
      ) {
        throw new Error("A material objective proposal must SET one non-empty objective string.");
      }
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
  investigationQueries?: readonly string[];
  advisoryRequested?: boolean;
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
    investigationQueries: [...(input.investigationQueries ?? [])],
    advisoryRequested: input.advisoryRequested ?? false,
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

function publicCognition(result: SolandraCognitionResult | undefined): unknown {
  if (!result) return undefined;
  return {
    authority: "NON_AUTHORITATIVE_PROPOSAL",
    objectiveRelation: result.proposal.objectiveRelation,
    proposedObjective: result.proposal.proposedObjective,
    requestedHelp: result.proposal.requestedHelp,
    entities: result.proposal.entities,
    referents: result.proposal.referents,
    constraints: result.proposal.constraints,
    preferences: result.proposal.preferences,
    knowledgeNeeds: result.proposal.knowledgeNeeds,
    materialAmbiguity: result.proposal.materialAmbiguity,
    referencedKnowledgeId: result.proposal.referencedKnowledgeId,
    referencedRecommendationId: result.proposal.referencedRecommendationId ?? null,
    referencedOptionId: result.proposal.referencedOptionId ?? null,
    proposedNextStep: result.proposal.proposedNextStep,
  };
}

function isReferenceHelp(help: SolandraRequestedHelp): boolean {
  return help === "SOURCES_REFERENCE"
    || help === "EXPLAIN_REFERENCE"
    || help === "SIMPLIFY_REFERENCE";
}

function isRecommendationReferenceHelp(help: SolandraRequestedHelp): boolean {
  return help === "EXPLAIN_RECOMMENDATION" || help === "SOURCES_RECOMMENDATION";
}

function isOptionReferenceHelp(help: SolandraRequestedHelp): boolean {
  return help === "EXPLAIN_OPTION" || help === "ACCEPT_CHOICE";
}

function cognitiveInterpretation(
  sourceMessage: IntentUserMessage,
  currentVersion: IntentVersion | undefined,
  result: SolandraCognitionResult,
  explicitResourceNeed: ConsultationResourceNeed | undefined,
): ConsultationInterpretationProposal {
  const proposal = result.proposal;
  const exactUserMessage = sourceMessage.content.trim();
  const objectiveEffect: ConsultationInterpretationProposal["objectiveEffect"] = currentVersion === undefined
    ? { kind: "ESTABLISH", value: exactUserMessage }
    : proposal.objectiveRelation === "NEW_OBJECTIVE"
      ? { kind: "REPLACE_EXPLICIT", value: exactUserMessage }
      : proposal.objectiveRelation === "CORRECTION"
        && proposal.proposedObjective !== null
        && proposal.proposedObjective.trim() === exactUserMessage
        ? { kind: "REPLACE_EXPLICIT", value: exactUserMessage }
        : { kind: "PRESERVE" };

  const materialObjectiveProposal = currentVersion !== undefined
    && proposal.objectiveRelation === "CORRECTION"
    && proposal.proposedObjective !== null
    && proposal.proposedObjective.trim() !== exactUserMessage
    ? {
      operations: [{
        op: "SET" as const,
        path: { kind: "OBJECTIVE" as const },
        value: { state: "VALUE" as const, value: proposal.proposedObjective.trim() },
      }],
      question: `I understand your correction as: “${proposal.proposedObjective.trim()}” Is that what you mean?`,
      confirmationExample: "Yes, that's correct.",
    }
    : undefined;

  return {
    objectiveEffect,
    meaningKind: proposal.materialAmbiguity || materialObjectiveProposal ? "MATERIAL_INFERENCE" : "ORDINARY_CONTEXT",
    decisionRequested: false,
    resourceNeed: explicitResourceNeed ?? "NONE",
    ...(materialObjectiveProposal ? { materialClarification: materialObjectiveProposal } : {}),
    ...(proposal.materialAmbiguity && !materialObjectiveProposal
      ? { clarificationQuestion: proposal.materialAmbiguity.question }
      : {}),
  };
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

function advisoryKnowledgeRunId(
  rootRunId: string,
  intentVersionId: string,
  round: number,
): `${string}-${string}-${string}-${string}-${string}` {
  return stableUuid("advisory-knowledge-run", rootRunId, intentVersionId, String(round));
}

async function submitAdvisoryKnowledgeRun(input: {
  request: FastifyRequest;
  options: ConsultationIntakeOptions;
  apiSubjectForRequest: (request: FastifyRequest) => string;
  rootRun: LatticeRun & { request: ConsultationRunRequest };
  intentVersion: IntentVersion;
  round: number;
  knowledgeNeeds: readonly string[];
}): Promise<string> {
  const runId = advisoryKnowledgeRunId(input.rootRun.id, input.intentVersion.intentVersionId, input.round);
  const requestBody = consultationRequest({
    objective: authoritativeObjective(input.intentVersion),
    context: input.rootRun.request.context ?? [],
    investigationQueries: input.knowledgeNeeds,
    advisoryRequested: false,
    decisionNeed: "NONE",
    resourceNeed: "NONE",
    sourceMessageId: input.rootRun.request.sourceMessageId,
    sourceMessageDigest: input.rootRun.request.sourceMessageDigest,
    intentScopeId: input.intentVersion.intentScopeId,
    intentVersion: input.intentVersion,
  });
  const continuation = createPendingRun(input.rootRun.conversationId, requestBody, runId);
  const submission = await input.options.apiControlStore.submitRun({
    run: continuation,
    intentBinding: {
      intentScopeId: input.intentVersion.intentScopeId,
      intentVersionId: input.intentVersion.intentVersionId,
    },
    dispatch: {
      logicalKey: `run:${runId}:execute`,
      queueName: "lattice.run",
      payload: { runId, submittedVersion: continuation.version },
    },
    idempotency: {
      scopeKey: input.apiSubjectForRequest(input.request),
      httpMethod: "INTERNAL",
      canonicalRoute: `/internal/advisory/${encodeURIComponent(input.rootRun.id)}/knowledge/${input.round}`,
      idempotencyKey: `advisory-knowledge:${input.rootRun.id}:${input.round}`,
      requestHash: createApiRequestHash({
        rootRunId: input.rootRun.id,
        intentVersionId: input.intentVersion.intentVersionId,
        round: input.round,
        knowledgeNeeds: [...input.knowledgeNeeds],
      }),
      expiresAt: new Date(Date.now() + IDEMPOTENCY_RETENTION_MS),
    },
  });
  if (submission.outcome === "conflict") {
    throw new Error("Advisory Knowledge continuation idempotency conflicted with different immutable state.");
  }
  return runId;
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
      const history = await options.userMessageStore.listByConversation(conversationId);
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

      let cognition: SolandraCognitionResult | undefined;
      let interpretation: ConsultationInterpretationProposal;
      try {
        if (options.solandraCognition) {
          const governed = options.knowledgeStore
            ? await recentGovernedKnowledge(options.knowledgeStore, options.runStore, conversationId)
            : [];
          const recommendations = options.recommendationStore
            ? await options.recommendationStore.listRecommendationsByConversation(conversationId)
            : [];
          const recentMessages = [...history.map((message) => message.content)];
          if (!recentMessages.includes(sourceMessage.content)) recentMessages.push(sourceMessage.content);
          cognition = await options.solandraCognition.interpret({
            conversationId,
            messageId: sourceMessage.messageId,
            message: sourceMessage.content,
            ...(currentVersion ? { currentObjective: authoritativeObjective(currentVersion) } : {}),
            recentUserMessages: recentMessages.slice(-MAX_COGNITIVE_HISTORY_ITEMS),
            governedKnowledge: governed.map(governedKnowledgeContext),
            governedRecommendations: recommendations.slice(-4).map(recommendationContext),
          });
          const inferredResourceNeed = cognition.proposal.requestedHelp === "RESOURCE"
            ? inferConsultationResourceNeed(sourceMessage.content)
            : "NONE";
          if (
            cognition.proposal.requestedHelp === "RESOURCE"
            && parsed.data.prepare === undefined
            && inferredResourceNeed !== "PREPARED_MESSAGE"
          ) {
            return reply.status(422).send({
              error: "RESOURCE_SCOPE_UNSUPPORTED",
              message: "I can currently prepare an editable message, email, note, reply, or response. This requested resource type is not supported yet.",
              interpretation: publicCognition(cognition),
            });
          }
          interpretation = cognitiveInterpretation(
            sourceMessage,
            currentVersion,
            cognition,
            parsed.data.prepare ?? (inferredResourceNeed === "PREPARED_MESSAGE" ? inferredResourceNeed : undefined),
          );
        } else {
          interpretation = await interpreter.interpret({
            message: sourceMessage.content,
            context: parsed.data.context ?? [],
            ...(currentVersion ? { currentIntentVersion: currentVersion } : {}),
            ...(parsed.data.prepare ? { explicitResourceNeed: parsed.data.prepare } : {}),
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Consultation interpretation failed.";
        return reply.status(422).send({ error: "CONSULTATION_INTERPRETATION_FAILED", message });
      }

      if (cognition?.proposal.requestedHelp === "COGNITIVE_ASSISTANCE") {
        const broker = registeredCapabilityBrokerFor(app);
        if (!broker) {
          return reply.status(503).send({
            error: "COGNITIVE_ASSISTANCE_UNAVAILABLE",
            message: "The requested USER-authorized cognitive capability is not available in this Product composition.",
            interpretation: publicCognition(cognition),
          });
        }
        try {
          const result = await broker.invoke<UserModelInput, UserModelOutput>({
            subjectId: apiSubjectForRequest(request),
            capabilityId: USER_AUTHORIZED_MODEL_CAPABILITY_ID,
            requestId: `conversation:${sourceMessage.messageId}`,
            purpose: "ordinary-conversation-cognitive-assistance",
            payload: {
              purpose: "GENERAL_COGNITIVE_ASSISTANCE",
              instruction: sourceMessage.content,
              userContext: [sourceMessage.content],
              governedKnowledge: [],
            },
          });
          return reply.status(200).send({
            status: "COGNITIVE_ASSISTANCE_COMPLETED",
            presentation: { assistantMessage: result.output.text },
            interpretation: publicCognition(cognition),
            capability: {
              capabilityId: result.capabilityId,
              authority: result.output.authority,
              effect: result.effect,
              trustHandling: result.trustHandling,
            },
          });
        } catch (error) {
          if (error instanceof CapabilityUnavailableError) {
            return reply.status(503).send({
              error: "COGNITIVE_ASSISTANCE_UNAVAILABLE",
              message: "The requested USER-authorized cognitive capability is unavailable.",
              interpretation: publicCognition(cognition),
            });
          }
          if (error instanceof CapabilityNotAuthorizedError) {
            return reply.status(403).send({
              error: "COGNITIVE_ASSISTANCE_NOT_AUTHORIZED",
              message: "This cognitive capability requires an explicit USER grant before Solandra may use it.",
              interpretation: publicCognition(cognition),
            });
          }
          if (error instanceof CapabilityRevokedError) {
            return reply.status(409).send({
              error: "COGNITIVE_ASSISTANCE_REVOKED",
              message: "The capability grant changed before the result could be released, so the result was discarded.",
              interpretation: publicCognition(cognition),
            });
          }
          const message = error instanceof Error ? error.message : "Cognitive capability execution failed.";
          return reply.status(422).send({ error: "COGNITIVE_ASSISTANCE_FAILED", message });
        }
      }

      if (
        cognition
        && isOptionReferenceHelp(cognition.proposal.requestedHelp)
        && cognition.proposal.materialAmbiguity === null
        && (cognition.proposal.referencedRecommendationId ?? null) !== null
        && (cognition.proposal.referencedOptionId ?? null) !== null
      ) {
        if (!options.recommendationStore || !options.knowledgeStore || !currentVersion) {
          return reply.status(409).send({ error: "GOVERNED_OPTION_REFERENCE_UNAVAILABLE" });
        }
        const loaded = await loadRecommendation(
          options.recommendationStore,
          options.knowledgeStore,
          options.runStore,
          cognition.proposal.referencedRecommendationId!,
        );
        if (!loaded || loaded.record.conversationId !== conversationId) {
          return reply.status(404).send({ error: "RECOMMENDATION_NOT_FOUND" });
        }
        const option = recommendationOption(loaded.record, cognition.proposal.referencedOptionId!);
        if (!option) return reply.status(404).send({ error: "RECOMMENDATION_OPTION_NOT_FOUND" });
        if (cognition.proposal.requestedHelp === "EXPLAIN_OPTION") {
          return reply.status(200).send({
            status: "OPTION_REFERENCE_RESOLVED",
            acceptedUnderstanding: authoritativeObjective(currentVersion),
            intentScopeId,
            intentVersionId: currentVersion.intentVersionId,
            recommendationReference: { recommendationId: loaded.record.recommendationId },
            optionReference: option,
            presentation: {
              assistantMessage: `${option.text}\n\nThis is option ${option.position} from the exact prior Recommendation. Its historical Recommendation basis and uncertainty remain unchanged.`,
            },
            interpretation: publicCognition(cognition),
          });
        }
        if (!options.acceptedChoiceStore) {
          return reply.status(409).send({ error: "ACCEPTED_CHOICE_STORE_UNAVAILABLE" });
        }
        if (loaded.record.intentVersionId !== currentVersion.intentVersionId) {
          return reply.status(409).send({
            error: "ACCEPTED_CHOICE_BASIS_STALE",
            message: "That option belongs to an earlier Recommendation basis. Revisit the current Recommendation before preserving it as your choice.",
          });
        }
        const choice = buildAcceptedChoiceRecord({
          conversationId,
          intentScopeId,
          intentVersionId: currentVersion.intentVersionId,
          recommendationId: loaded.record.recommendationId,
          optionId: option.optionId,
          optionText: option.text,
          sourceMessageId: sourceMessage.messageId,
          sourceMessageDigest: sourceMessage.contentDigest,
          createdAt: sourceMessage.createdAt,
        });
        let acceptedChoice;
        try {
          acceptedChoice = await options.acceptedChoiceStore.putAcceptedChoice(choice);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Accepted USER choice could not be preserved.";
          return reply.status(409).send({ error: "ACCEPTED_CHOICE_CONFLICT", message });
        }
        return reply.status(200).send({
          status: "ACCEPTED_CHOICE_ESTABLISHED",
          acceptedUnderstanding: authoritativeObjective(currentVersion),
          intentScopeId,
          intentVersionId: currentVersion.intentVersionId,
          recommendationReference: { recommendationId: loaded.record.recommendationId },
          optionReference: option,
          acceptedChoice,
          presentation: { assistantMessage: `You chose: ${option.text}\n\nI preserved that as your choice. It does not authorize any external action.` },
          interpretation: publicCognition(cognition),
        });
      }

      if (
        cognition
        && isRecommendationReferenceHelp(cognition.proposal.requestedHelp)
        && cognition.proposal.materialAmbiguity === null
        && (cognition.proposal.referencedRecommendationId ?? null) !== null
      ) {
        if (!options.recommendationStore || !options.knowledgeStore || !currentVersion) {
          return reply.status(409).send({
            error: "GOVERNED_RECOMMENDATION_REFERENCE_UNAVAILABLE",
            message: "The referenced governed Recommendation is not available in this conversation state.",
          });
        }
        const recommendationId = cognition.proposal.referencedRecommendationId!;
        const loaded = await loadRecommendation(
          options.recommendationStore,
          options.knowledgeStore,
          options.runStore,
          recommendationId,
        );
        if (!loaded || loaded.record.conversationId !== conversationId) {
          return reply.status(404).send({ error: "RECOMMENDATION_NOT_FOUND" });
        }
        const assistantMessage = cognition.proposal.requestedHelp === "SOURCES_RECOMMENDATION"
          ? renderHistoricalRecommendationSources(loaded)
          : renderHistoricalRecommendationExplanation(loaded);
        return reply.status(200).send({
          status: "RECOMMENDATION_REFERENCE_RESOLVED",
          acceptedUnderstanding: authoritativeObjective(currentVersion),
          intentScopeId,
          intentVersionId: currentVersion.intentVersionId,
          recommendationReference: {
            recommendationId: loaded.record.recommendationId,
            knowledgeIds: loaded.record.knowledgeIds,
          },
          presentation: { assistantMessage },
          interpretation: publicCognition(cognition),
        });
      }

      if (
        cognition
        && isReferenceHelp(cognition.proposal.requestedHelp)
        && cognition.proposal.materialAmbiguity === null
        && cognition.proposal.referencedKnowledgeId !== null
      ) {
        if (!options.knowledgeStore || !currentVersion) {
          return reply.status(409).send({
            error: "GOVERNED_KNOWLEDGE_REFERENCE_UNAVAILABLE",
            message: "The referenced governed Knowledge is not available in this conversation state.",
          });
        }
        const loaded = await loadKnowledge(
          options.knowledgeStore,
          options.runStore,
          cognition.proposal.referencedKnowledgeId,
        );
        if (!loaded || loaded.record.conversationId !== conversationId) {
          return reply.status(404).send({ error: "KNOWLEDGE_NOT_FOUND" });
        }

        let assistantMessage: string;
        if (cognition.proposal.requestedHelp === "SOURCES_REFERENCE") {
          assistantMessage = renderHistoricalSources(loaded);
        } else {
          if (!options.solandraKnowledgePresenter) {
            return reply.status(503).send({ error: "SOLANDRA_KNOWLEDGE_PRESENTATION_UNAVAILABLE" });
          }
          const presented = await options.solandraKnowledgePresenter.present({
            knowledgeId: loaded.record.knowledgeId,
            userMessageId: sourceMessage.messageId,
            mode: cognition.proposal.requestedHelp === "SIMPLIFY_REFERENCE" ? "SIMPLIFY" : "EXPLAIN",
            knowledge: loaded.knowledge,
          });
          if (presented.status === "NEEDS_NEW_KNOWLEDGE") {
            return reply.status(202).send({
              status: "NEEDS_NEW_KNOWLEDGE",
              acceptedUnderstanding: authoritativeObjective(currentVersion),
              intentScopeId,
              intentVersionId: currentVersion.intentVersionId,
              knowledgeId: loaded.record.knowledgeId,
              question: "That would require factual Knowledge beyond what I previously established. Ask me to investigate it as new Knowledge.",
              interpretation: publicCognition(cognition),
            });
          }
          assistantMessage = presented.status === "PRESENTED"
            ? presented.text
            : "I couldn't transform that faithfully, so I kept the established Knowledge unchanged.";
        }

        const reference = await referenceKnowledge(options.knowledgeStore, {
          knowledge: loaded.record,
          userMessageId: sourceMessage.messageId,
          intentVersionId: currentVersion.intentVersionId,
          createdAt: sourceMessage.createdAt,
        });
        return reply.status(200).send({
          status: "REFERENCE_RESOLVED",
          acceptedUnderstanding: authoritativeObjective(currentVersion),
          intentScopeId,
          intentVersionId: currentVersion.intentVersionId,
          knowledge: loaded.knowledge,
          knowledgeReference: {
            knowledgeId: loaded.record.knowledgeId,
            referenceId: reference.referenceId,
            responseId: reference.responseId,
          },
          presentation: { assistantMessage },
          interpretation: publicCognition(cognition),
        });
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
      } else if (
        interpretation.objectiveEffect.kind === "PRESERVE"
        || currentVersion?.transitionId === transition.transitionId
      ) {
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

      if (interpretation.clarificationQuestion) {
        return reply.status(202).send({
          status: "NEEDS_CLARIFICATION",
          decisionNeed: "NONE",
          acceptedUnderstanding: authoritativeObjective(version),
          intentScopeId,
          intentVersionId: version.intentVersionId,
          question: interpretation.clarificationQuestion,
          confirmationExample: null,
          interpretation: publicCognition(cognition),
        });
      }

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
          decisionNeed: interpretation.decisionRequested ? "UNRESOLVED" : "NONE",
          acceptedUnderstanding: authoritativeObjective(version),
          intentScopeId,
          intentVersionId: version.intentVersionId,
          proposalId: proposal.proposalId,
          proposalDigest: proposal.proposalDigest,
          question: interpretation.materialClarification.question,
          confirmationExample: interpretation.materialClarification.confirmationExample,
          interpretation: publicCognition(cognition),
        });
      }

      if (
        cognition?.proposal.requestedHelp === "DECISION"
        && cognition.proposal.materialAmbiguity === null
        && cognition.proposal.knowledgeNeeds.length === 0
        && options.recommendationStore
        && options.solandraAdvisory
      ) {
        const governed = options.knowledgeStore
          ? await recentGovernedKnowledge(options.knowledgeStore, options.runStore, conversationId, 4)
          : [];
        let advisory;
        try {
          advisory = await options.solandraAdvisory.advise({
            conversationId,
            userMessageId: sourceMessage.messageId,
            authoritativeIntent: version,
            authoritativeObjective: authoritativeObjective(version),
            userContext: [sourceMessage.content],
            knowledge: governed.map(advisoryKnowledge),
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Solandra advisory reasoning failed.";
          return reply.status(422).send({ error: "SOLANDRA_ADVISORY_FAILED", message });
        }
        if (advisory.result.status === "RECOMMENDATION") {
          const recommendation = await establishConversationalRecommendation({
            store: options.recommendationStore,
            conversationId,
            intentVersion: version,
            sourceMessage,
            knowledge: governed,
            advisory: advisory.result,
          });
          return reply.status(200).send({
            status: "RECOMMENDATION_ESTABLISHED",
            acceptedUnderstanding: authoritativeObjective(version),
            intentScopeId,
            intentVersionId: version.intentVersionId,
            recommendationReference: {
              recommendationId: recommendation.recommendationId,
              intentVersionId: recommendation.intentVersionId,
              knowledgeIds: recommendation.knowledgeIds,
              claimIds: recommendation.claimIds,
              options: recommendationOptions(recommendation),
              selectionAuthorized: false,
            },
            presentation: { assistantMessage: renderRecommendation(recommendation) },
            interpretation: publicCognition(cognition),
          });
        }
        if (advisory.result.status === "NEEDS_CLARIFICATION") {
          return reply.status(202).send({
            status: "NEEDS_CLARIFICATION",
            acceptedUnderstanding: authoritativeObjective(version),
            intentScopeId,
            intentVersionId: version.intentVersionId,
            question: advisory.result.question,
            confirmationExample: null,
            interpretation: publicCognition(cognition),
          });
        }
        if (advisory.result.status === "INSUFFICIENT_BASIS") {
          return reply.status(200).send({
            status: "ADVISORY_INSUFFICIENT_BASIS",
            acceptedUnderstanding: authoritativeObjective(version),
            intentScopeId,
            intentVersionId: version.intentVersionId,
            advisory: advisory.result,
            presentation: { assistantMessage: `I don't have a sufficient basis for a responsible recommendation. ${advisory.result.reason}` },
            interpretation: publicCognition(cognition),
          });
        }
      }

      const qualification = interpretation.decisionRequested
        ? qualifiedDecisionNeed(version, options.criterionCatalog)
        : { decisionNeed: "NONE" as const };
      const sourceTurnAuthoredVersion = version.transitionId === transition.transitionId;
      const runContext = interpretation.objectiveEffect.kind === "PRESERVE" && !sourceTurnAuthoredVersion
        ? [sourceMessage.content, ...(parsed.data.context ?? [])]
        : [...(parsed.data.context ?? [])];
      if (runContext.length > MAX_RUN_CONTEXT_ITEMS) {
        return reply.status(400).send({
          error: "CONSULTATION_CONTEXT_LIMIT_EXCEEDED",
          message: `Current-turn work context is limited to ${MAX_RUN_CONTEXT_ITEMS} items.`,
        });
      }
      const advisoryRequested = cognition?.proposal.requestedHelp === "DECISION";
      const investigationQueries = cognition
        && (
          cognition.proposal.requestedHelp === "KNOWLEDGE"
          || cognition.proposal.requestedHelp === "FRESH_RESEARCH"
          || cognition.proposal.requestedHelp === "DECISION"
        )
        ? cognition.proposal.knowledgeNeeds
        : [];
      const requestBody = consultationRequest({
        objective: authoritativeObjective(version),
        context: runContext,
        investigationQueries,
        advisoryRequested,
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
          investigationQueries: requestBody.investigationQueries,
          advisoryRequested: requestBody.advisoryRequested,
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
        interpretation: publicCognition(cognition),
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

      const includesDecisionSemantics = proposal.operations.some((operation) =>
        operation.path.kind === "REQUIREMENT" || operation.path.kind === "PREFERENCE");
      const qualification = includesDecisionSemantics
        ? qualifiedDecisionNeed(version, options.criterionCatalog)
        : { decisionNeed: "NONE" as const };
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
        investigationQueries: [],
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
    const outcome = buildRunOutcome(run, truth);
    if (
      outcome.kind === "ACTION_PREPARATION"
      && outcome.resource.kind === "PREPARED_MESSAGE"
      && isConsultationRunRequest(run.request)
    ) {
      if (!options.knowledgeStore || !options.preparedResourceStore || !options.solandraActionPreparer) {
        return reply.status(503).send({
          error: "SOLANDRA_ACTION_PREPARATION_UNAVAILABLE",
          message: "Editable message preparation is not available in the current Product composition.",
        });
      }
      const intentScopeId = run.request.intentScopeId;
      const intentVersionId = run.request.intentVersionId;
      if (!intentScopeId || !intentVersionId) {
        return reply.status(409).send({ error: "ACTION_PREPARATION_INTENT_BINDING_UNAVAILABLE" });
      }
      const intentVersion = await options.intentStore.getVersion(intentVersionId);
      if (!intentVersion || intentVersion.intentScopeId !== intentScopeId) {
        return reply.status(409).send({ error: "ACTION_PREPARATION_INTENT_BINDING_UNAVAILABLE" });
      }
      const established = await establishKnowledge(options.knowledgeStore, run, truth, outcome.knowledge);
      const knowledgeReference = {
        knowledgeId: established.record.knowledgeId,
        referenceId: established.reference.referenceId,
        responseId: established.reference.responseId,
      };
      let prepared = await options.preparedResourceStore.getPreparedResourceByRunId(run.id);
      if (!prepared) {
        const sourceMessage = await options.userMessageStore.get(run.request.sourceMessageId);
        if (!sourceMessage || sourceMessage.conversationId !== run.conversationId) {
          return reply.status(409).send({ error: "ACTION_PREPARATION_USER_SOURCE_UNAVAILABLE" });
        }
        const recent = await recentGovernedKnowledge(
          options.knowledgeStore,
          options.runStore,
          run.conversationId,
          4,
        );
        const priorGoverned = recent.filter((item) => item.record.runId !== run.id);
        const currentGoverned = priorGoverned.length === 0
          ? await loadKnowledge(options.knowledgeStore, options.runStore, established.record.knowledgeId)
          : undefined;
        const governed = priorGoverned.length > 0
          ? priorGoverned
          : currentGoverned
            ? [currentGoverned]
            : [];
        if (governed.length === 0) {
          return reply.status(409).send({ error: "ACTION_PREPARATION_KNOWLEDGE_UNAVAILABLE" });
        }
        let generated;
        try {
          generated = await options.solandraActionPreparer.prepare({
            conversationId: run.conversationId,
            runId: run.id,
            intentVersionId,
            userMessageId: sourceMessage.messageId,
            userMessage: sourceMessage.content,
            authoritativeObjective: authoritativeObjective(intentVersion),
            knowledge: governed.map(governedKnowledgeContext),
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Solandra Action Preparation failed.";
          return reply.status(422).send({ error: "SOLANDRA_ACTION_PREPARATION_FAILED", message });
        }
        if (generated.result.status !== "PREPARED") {
          return reply.status(422).send({
            error: "SOLANDRA_ACTION_PREPARATION_FAILED",
            status: generated.result.status,
            message: generated.result.reason,
          });
        }
        const candidate = buildPreparedResourceRecord({
          conversationId: run.conversationId,
          runId: run.id,
          intentScopeId,
          intentVersionId,
          sourceMessageId: sourceMessage.messageId,
          kind: "PREPARED_MESSAGE",
          title: "Prepared message",
          body: generated.result.body,
          basis: generated.result.basis,
          preservedUncertainties: generated.result.preservedUncertainties,
          createdAt: sourceMessage.createdAt,
        });
        try {
          prepared = await options.preparedResourceStore.putPreparedResource(candidate);
        } catch (error) {
          const raced = await options.preparedResourceStore.getPreparedResourceByRunId(run.id);
          if (!raced) throw error;
          prepared = raced;
        }
      }
      const preparedOutcome = {
        ...outcome,
        resource: preparedResourceFromRecord(prepared),
      };
      return reply.send({
        runId: run.id,
        status: run.status,
        outcome: preparedOutcome,
        knowledgeReference,
        preparationReference: {
          resourceId: prepared.resourceId,
          intentVersionId: prepared.intentVersionId,
          knowledgeIds: prepared.knowledgeIds,
          claimIds: prepared.claimIds,
          editable: prepared.editable,
          executionAuthorized: prepared.executionAuthorized,
        },
      });
    }
    if (outcome.kind !== "KNOWLEDGE" || !options.knowledgeStore) {
      return reply.send({ runId: run.id, status: run.status, outcome });
    }
    const established = await establishKnowledge(options.knowledgeStore, run, truth, outcome);
    const knowledgeReference = {
      knowledgeId: established.record.knowledgeId,
      referenceId: established.reference.referenceId,
      responseId: established.reference.responseId,
    };

    if (isConsultationRunRequest(run.request) && run.request.advisoryRequested) {
      if (!options.recommendationStore || !options.solandraAdvisory) {
        return reply.status(503).send({ error: "SOLANDRA_ADVISORY_UNAVAILABLE" });
      }
      const existing = await loadRecommendationByRunId(
        options.recommendationStore,
        options.knowledgeStore,
        options.runStore,
        run.id,
      );
      if (existing) {
        return reply.send({
          runId: run.id,
          status: run.status,
          outcome,
          knowledgeReference,
          recommendationReference: {
            recommendationId: existing.record.recommendationId,
            intentVersionId: existing.record.intentVersionId,
            knowledgeIds: existing.record.knowledgeIds,
            claimIds: existing.record.claimIds,
            options: recommendationOptions(existing.record),
            selectionAuthorized: existing.record.selectionAuthorized,
          },
          presentation: { assistantMessage: renderRecommendation(existing.record) },
        });
      }

      const intentVersionId = run.request.intentVersionId;
      const intentVersion = intentVersionId ? await options.intentStore.getVersion(intentVersionId) : undefined;
      if (!intentVersion) return reply.status(409).send({ error: "ADVISORY_INTENT_VERSION_UNAVAILABLE" });
      const rootKnowledge = await loadKnowledge(options.knowledgeStore, options.runStore, established.record.knowledgeId);
      if (!rootKnowledge) return reply.status(409).send({ error: "ADVISORY_KNOWLEDGE_UNAVAILABLE" });
      const sourceMessage = await options.userMessageStore.get(run.request.sourceMessageId);
      if (!sourceMessage || sourceMessage.conversationId !== run.conversationId) {
        return reply.status(409).send({ error: "ADVISORY_USER_SOURCE_UNAVAILABLE" });
      }

      const governedKnowledge = [rootKnowledge];
      let nextKnowledgeRound = 1;
      for (; nextKnowledgeRound <= MAX_ADVISORY_KNOWLEDGE_ROUNDS; nextKnowledgeRound += 1) {
        const continuationRunId = advisoryKnowledgeRunId(run.id, intentVersion.intentVersionId, nextKnowledgeRound);
        const continuationRun = await options.runStore.get(continuationRunId);
        if (!continuationRun) break;
        if (continuationRun.status === "FAILED" || continuationRun.status === "CANCELLED") {
          const reason = "I couldn't establish the additional governed Knowledge needed for a responsible recommendation.";
          return reply.send({
            runId: run.id,
            status: run.status,
            outcome,
            knowledgeReference,
            advisory: { status: "INSUFFICIENT_BASIS", reason, uncertainties: [reason] },
            presentation: { assistantMessage: reason },
          });
        }
        if (continuationRun.status !== "COMPLETED") {
          return reply.status(202).send({ runId: run.id, status: "INVESTIGATING" });
        }
        const continuationTruth = await options.runStore.getTruthBundle(continuationRun.id);
        if (!continuationTruth) {
          return reply.status(409).send({ error: "ADVISORY_CONTINUATION_TRUTH_UNAVAILABLE" });
        }
        const continuationOutcome = buildRunOutcome(continuationRun, continuationTruth);
        if (continuationOutcome.kind !== "KNOWLEDGE") {
          return reply.status(409).send({ error: "ADVISORY_CONTINUATION_KNOWLEDGE_UNAVAILABLE" });
        }
        const continuationEstablished = await establishKnowledge(
          options.knowledgeStore,
          continuationRun,
          continuationTruth,
          continuationOutcome,
        );
        const continuationKnowledge = await loadKnowledge(
          options.knowledgeStore,
          options.runStore,
          continuationEstablished.record.knowledgeId,
        );
        if (!continuationKnowledge) {
          return reply.status(409).send({ error: "ADVISORY_CONTINUATION_KNOWLEDGE_UNAVAILABLE" });
        }
        governedKnowledge.push(continuationKnowledge);
      }

      let advisory;
      try {
        advisory = await options.solandraAdvisory.advise({
          conversationId: run.conversationId,
          userMessageId: sourceMessage.messageId,
          authoritativeIntent: intentVersion,
          authoritativeObjective: authoritativeObjective(intentVersion),
          userContext: [sourceMessage.content],
          knowledge: governedKnowledge.map(advisoryKnowledge),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Solandra advisory reasoning failed.";
        return reply.status(422).send({ error: "SOLANDRA_ADVISORY_FAILED", message });
      }

      if (advisory.result.status === "NEEDS_KNOWLEDGE") {
        if (nextKnowledgeRound > MAX_ADVISORY_KNOWLEDGE_ROUNDS) {
          const reason = "I still need additional factual Knowledge after the bounded investigation available for this recommendation, so I can't recommend responsibly yet.";
          return reply.send({
            runId: run.id,
            status: run.status,
            outcome,
            knowledgeReference,
            advisory: {
              status: "INSUFFICIENT_BASIS",
              reason,
              uncertainties: [advisory.result.reason, ...advisory.result.knowledgeNeeds],
            },
            presentation: { assistantMessage: reason },
          });
        }
        try {
          await submitAdvisoryKnowledgeRun({
            request,
            options,
            apiSubjectForRequest,
            rootRun: run as LatticeRun & { request: ConsultationRunRequest },
            intentVersion,
            round: nextKnowledgeRound,
            knowledgeNeeds: advisory.result.knowledgeNeeds,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Additional governed Knowledge could not be scheduled.";
          return reply.status(409).send({ error: "ADVISORY_KNOWLEDGE_CONTINUATION_FAILED", message });
        }
        return reply.status(202).send({ runId: run.id, status: "INVESTIGATING" });
      }

      if (advisory.result.status !== "RECOMMENDATION") {
        const assistantMessage = advisory.result.status === "NEEDS_CLARIFICATION"
          ? advisory.result.question
          : `I don't have a sufficient governed basis for a responsible recommendation. ${advisory.result.reason}`;
        return reply.send({
          runId: run.id,
          status: run.status,
          outcome,
          knowledgeReference,
          advisory: advisory.result,
          presentation: { assistantMessage },
        });
      }

      const recommendation = await establishRecommendation({
        store: options.recommendationStore,
        run,
        intentVersion,
        knowledge: governedKnowledge,
        advisory: advisory.result,
      });
      return reply.send({
        runId: run.id,
        status: run.status,
        outcome,
        knowledgeReference,
        recommendationReference: {
          recommendationId: recommendation.recommendationId,
          intentVersionId: recommendation.intentVersionId,
          knowledgeIds: recommendation.knowledgeIds,
          claimIds: recommendation.claimIds,
          options: recommendationOptions(recommendation),
          selectionAuthorized: recommendation.selectionAuthorized,
        },
        presentation: { assistantMessage: renderRecommendation(recommendation) },
      });
    }

    return reply.send({
      runId: run.id,
      status: run.status,
      outcome,
      knowledgeReference,
    });
  });

  app.get<{ Params: { knowledgeId: string } }>("/api/v1/knowledge/:knowledgeId", async (request, reply) => {
    if (!options.knowledgeStore) return reply.status(404).send({ error: "KNOWLEDGE_NOT_FOUND" });
    const loaded = await loadKnowledge(options.knowledgeStore, options.runStore, request.params.knowledgeId.trim());
    if (!loaded) return reply.status(404).send({ error: "KNOWLEDGE_NOT_FOUND" });
    if (!await options.conversationStore.getOwned(loaded.record.conversationId, apiSubjectForRequest(request))) {
      return reply.status(404).send({ error: "KNOWLEDGE_NOT_FOUND" });
    }
    return reply.status(200).send({
      knowledgeId: loaded.record.knowledgeId,
      intentScopeId: loaded.record.intentScopeId,
      intentVersionId: loaded.record.intentVersionId,
      runId: loaded.record.runId,
      asOf: loaded.record.asOf,
      claimIds: loaded.record.claimIds,
      sourceIds: loaded.record.sourceIds,
      evidenceIds: loaded.record.evidenceIds,
      truthAssessmentIds: loaded.record.truthAssessmentIds,
      outcome: loaded.knowledge,
    });
  });


  app.get<{ Params: { recommendationId: string } }>("/api/v1/recommendations/:recommendationId", async (request, reply) => {
    if (!options.recommendationStore || !options.knowledgeStore) {
      return reply.status(404).send({ error: "RECOMMENDATION_NOT_FOUND" });
    }
    const loaded = await loadRecommendation(
      options.recommendationStore,
      options.knowledgeStore,
      options.runStore,
      request.params.recommendationId.trim(),
    );
    if (!loaded || !await options.conversationStore.getOwned(loaded.record.conversationId, apiSubjectForRequest(request))) {
      return reply.status(404).send({ error: "RECOMMENDATION_NOT_FOUND" });
    }
    return reply.status(200).send({
      ...loaded.record,
      factualBasis: recommendationBasisTrace(loaded),
    });
  });
}
