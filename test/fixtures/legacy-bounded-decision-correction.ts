import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ApiRunControlStore } from "../../src/api-control-store.js";
import type { LatticeRun, RunRequest, RunStatus } from "../../src/domain.js";
import { createPendingRun } from "../../src/run-execution.js";
import { deriveQualifiedLegacyBoundedRunRequest } from "./legacy-exact-planning-fidelity.js";
import type { IntentAuthorityStore } from "../../src/intent/store.js";
import type { IntentUserMessageStore } from "../../src/intent/source-message-store.js";

const USER_TEXT_MAX_CHARS = 2_000;
const ID_MAX_CHARS = 200;
const BOUNDED_CORRECTION_HORIZON = 3;
const terminalRunStatuses = new Set<RunStatus>(["COMPLETED", "CANCELLED", "FAILED"]);

const correctionMessageSchema = z.object({
  turnId: z.string().min(1).max(ID_MAX_CHARS),
  messageId: z.string().min(1).max(ID_MAX_CHARS),
  content: z.string().min(1).max(USER_TEXT_MAX_CHARS).refine(
    (value) => value.trim().length > 0,
    "content must contain non-whitespace USER text",
  ),
}).strict();

export interface BoundedDecisionCorrectionOptions {
  intentStore: IntentAuthorityStore;
  userMessageStore: IntentUserMessageStore;
  apiControlStore: ApiRunControlStore;
  runStore: import("../../src/run-store.js").RunStore;
}

function digestHex(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\u001f")).digest("hex");
}

function stableId(prefix: string, ...parts: string[]): string {
  return `m5j-${prefix}-${digestHex(...parts).slice(0, 32)}`;
}

function stableUuid(...parts: string[]): `${string}-${string}-${string}-${string}-${string}` {
  const digest = digestHex(...parts).slice(0, 32);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
}

function normalizeUserText(value: string): string {
  return value.trim().replaceAll("’", "'").replace(/\s+/g, " ");
}

function parseBoundedBudgetCorrection(content: string): number | undefined {
  const normalized = normalizeUserText(content);
  const match = /^actually,? make the budget \$?([0-9][0-9,]*(?:\.[0-9]{1,2})?)\.?$/i.exec(normalized);
  if (!match) return undefined;
  const priceMaxUsd = Number(match[1]?.replaceAll(",", ""));
  return Number.isFinite(priceMaxUsd) && priceMaxUsd > 0 ? priceMaxUsd : undefined;
}

function committedCorrection(result: {
  disposition: string;
  replayedDisposition?: string;
}): boolean {
  return result.disposition === "COMMITTED"
    || (result.disposition === "REPLAYED" && result.replayedDisposition === "COMMITTED");
}

function historicalSupersessionCas(run: LatticeRun): { status: RunStatus; version: number } | undefined {
  if (run.status !== "CANCELLED" || run.version <= 1) return undefined;
  const cancellation = run.events.at(-1);
  const predecessorEvent = run.events.at(-2);
  if (
    cancellation?.type !== "CANCELLED"
    || !predecessorEvent
    || predecessorEvent.type === "EXPLAINING"
    || terminalRunStatuses.has(predecessorEvent.type)
  ) {
    return undefined;
  }
  return { status: predecessorEvent.type, version: run.version - 1 };
}

export function registerBoundedDecisionCorrection(
  app: FastifyInstance,
  options: BoundedDecisionCorrectionOptions,
): void {
  app.post<{ Params: { conversationId: string; intentScopeId: string; runId: string } }>(
    "/api/v1/conversations/:conversationId/intent-scopes/:intentScopeId/runs/:runId/corrections",
    async (request, reply) => {
      const parsedBody = correctionMessageSchema.safeParse(request.body);
      if (!parsedBody.success) {
        return reply.status(400).send({ error: "INVALID_BOUNDED_CORRECTION_MESSAGE", details: parsedBody.error.flatten() });
      }

      const conversationId = request.params.conversationId.trim();
      const intentScopeId = request.params.intentScopeId.trim();
      const predecessorRunId = request.params.runId.trim();
      if (!conversationId || !intentScopeId || !predecessorRunId) {
        return reply.status(400).send({ error: "INVALID_BOUNDED_CORRECTION_ROUTE" });
      }

      const correctedPriceMaxUsd = parseBoundedBudgetCorrection(parsedBody.data.content);
      if (correctedPriceMaxUsd === undefined) {
        return reply.status(422).send({
          error: "BOUNDED_CORRECTION_NOT_REPRESENTABLE",
          message: "This bounded decision slice accepts only an explicit budget correction; unsupported text cannot change canonical intent or supersede a Run.",
        });
      }

      let sourceMessage;
      try {
        sourceMessage = await options.userMessageStore.append({
          conversationId,
          intentScopeId,
          logicalUserTurnId: parsedBody.data.turnId,
          messageId: parsedBody.data.messageId,
          messageHorizon: BOUNDED_CORRECTION_HORIZON,
          content: parsedBody.data.content,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "USER correction provenance conflict.";
        return reply.status(409).send({ error: "USER_MESSAGE_PROVENANCE_CONFLICT", message });
      }

      const transitionId = stableId(
        "budget-correction",
        intentScopeId,
        sourceMessage.logicalUserTurnId,
        sourceMessage.messageId,
        sourceMessage.contentDigest,
      );
      const scope = await options.intentStore.getScope(intentScopeId);
      if (!scope) return reply.status(404).send({ error: "BOUND_INTENT_SCOPE_NOT_FOUND" });

      const currentVersion = await options.intentStore.getVersion(scope.currentIntentVersionId);
      if (!currentVersion) return reply.status(500).send({ error: "BOUND_CURRENT_INTENT_VERSION_MISSING" });

      const replayingCurrentCorrection = currentVersion.transitionId === transitionId
        && currentVersion.lineageKind === "CORRECTION";
      const correctionBase = replayingCurrentCorrection
        ? currentVersion.predecessorIntentVersionId
          ? await options.intentStore.getVersion(currentVersion.predecessorIntentVersionId)
          : undefined
        : currentVersion;
      if (!correctionBase?.predecessorIntentVersionId) {
        return reply.status(422).send({ error: "BOUND_CORRECTION_TARGET_UNAVAILABLE" });
      }
      const correctionTarget = await options.intentStore.getVersion(correctionBase.predecessorIntentVersionId);
      if (!correctionTarget || correctionTarget.intentScopeId !== intentScopeId) {
        return reply.status(422).send({ error: "BOUND_CORRECTION_TARGET_UNAVAILABLE" });
      }

      if (!replayingCurrentCorrection) {
        const predecessor = await options.runStore.get(predecessorRunId);
        if (!predecessor || predecessor.conversationId !== conversationId) {
          return reply.status(404).send({ error: "BOUND_PREDECESSOR_RUN_NOT_FOUND" });
        }
        if (terminalRunStatuses.has(predecessor.status)) {
          return reply.status(409).send({ error: "BOUND_PREDECESSOR_RUN_TERMINAL", status: predecessor.status });
        }
      }

      const correction = await options.intentStore.applyCorrection({
        transitionId,
        intentScopeId,
        baseIntentVersionId: correctionBase.intentVersionId,
        correctsIntentVersionId: correctionTarget.intentVersionId,
        logicalUserTurnId: sourceMessage.logicalUserTurnId,
        observedMessageHorizon: sourceMessage.messageHorizon,
        sourceMessageId: sourceMessage.messageId,
        sourceDigest: sourceMessage.contentDigest,
        operations: [
          {
            op: "SET",
            path: { kind: "REQUIREMENT", key: "price.max.usd" },
            value: { state: "VALUE", value: correctedPriceMaxUsd },
          },
        ],
      });
      if (!committedCorrection(correction) || !correction.resultingIntentVersionId) {
        const statusCode = correction.disposition === "REJECTED_STALE" ? 409 : 422;
        return reply.status(statusCode).send({
          error: "BOUND_MATERIAL_CORRECTION_REJECTED",
          disposition: correction.disposition,
        });
      }

      const correctedVersion = await options.intentStore.getVersion(correction.resultingIntentVersionId);
      if (!correctedVersion || correctedVersion.intentScopeId !== intentScopeId) {
        return reply.status(500).send({ error: "BOUND_CORRECTED_INTENT_VERSION_MISSING" });
      }

      let successorRequest: RunRequest;
      try {
        successorRequest = deriveQualifiedLegacyBoundedRunRequest(correctedVersion.state);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Corrected bounded planning failed.";
        return reply.status(422).send({ error: "BOUND_CORRECTED_PLANNING_REJECTED", message });
      }

      const predecessor = await options.runStore.get(predecessorRunId);
      if (!predecessor || predecessor.conversationId !== conversationId) {
        return reply.status(404).send({ error: "BOUND_PREDECESSOR_RUN_NOT_FOUND" });
      }

      let expectedPredecessorStatus = predecessor.status;
      let expectedPredecessorVersion = predecessor.version;
      if (replayingCurrentCorrection && predecessor.status === "CANCELLED") {
        const historicalCas = historicalSupersessionCas(predecessor);
        if (!historicalCas) {
          return reply.status(409).send({ error: "BOUND_MATERIAL_CORRECTION_REPLAY_LINEAGE_UNAVAILABLE" });
        }
        expectedPredecessorStatus = historicalCas.status;
        expectedPredecessorVersion = historicalCas.version;
      }

      const successorRunId = stableUuid(
        "successor-run",
        intentScopeId,
        predecessorRunId,
        transitionId,
        correctedVersion.intentVersionId,
      );
      const successorRun = createPendingRun(conversationId, successorRequest, successorRunId);
      const supersessionId = stableId(
        "run-supersession",
        predecessorRunId,
        successorRunId,
        correctedVersion.intentVersionId,
      );

      try {
        const supersession = await options.apiControlStore.supersedeRun({
          supersession: {
            supersessionId,
            predecessorRunId,
            expectedPredecessorStatus,
            expectedPredecessorVersion,
            successorRun,
            successorBinding: {
              intentScopeId,
              intentVersionId: correctedVersion.intentVersionId,
            },
          },
          dispatch: {
            logicalKey: `run:${successorRun.id}:execute`,
            queueName: "lattice.run",
            payload: { runId: successorRun.id, submittedVersion: successorRun.version },
          },
        });
        if (supersession.outcome === "stale") {
          return reply.status(409).send({ error: "BOUND_MATERIAL_CORRECTION_RUN_STALE" });
        }
        return reply.status(202).send({
          status: "RUN_SUPERSEDED",
          supersededRunId: predecessorRunId,
          runId: supersession.response.runId,
          supersessionId: supersession.response.supersessionId,
          intentScopeId,
          predecessorIntentVersionId: supersession.record.predecessorIntentVersionId,
          intentVersionId: supersession.record.successorIntentVersionId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Material correction Run supersession failed.";
        return reply.status(409).send({ error: "BOUND_MATERIAL_CORRECTION_RUN_REJECTED", message });
      }
    },
  );
}
