import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { FastifyInstance, InjectOptions } from "fastify";
import type {
  KnowledgeAcquisitionProvider,
  KnowledgeAcquisitionRequest,
  KnowledgeAcquisitionResult,
} from "../src/knowledge/acquisition.js";
import {
  ObjectiveKnowledgeRelevanceQualifier,
} from "../src/knowledge/investigation.js";
import { WikimediaKnowledgeAcquisitionProvider } from "../src/knowledge/wikimedia-acquisition.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import { createConfiguredSolandraCognition } from "../src/solandra/cognition-composition.js";

const CASES = [
  {
    id: "A1",
    pair: "soil",
    message: "I need to know how to prepare my soil for sod.",
  },
  {
    id: "A2",
    pair: "soil",
    message: "How do I prepare my soil for sod?",
  },
  {
    id: "B1",
    pair: "cookware",
    message: "I need to know how to season a cast iron skillet.",
  },
  {
    id: "B2",
    pair: "cookware",
    message: "How do I season a cast iron skillet?",
  },
] as const;

interface RecordedAcquisition {
  request: KnowledgeAcquisitionRequest;
  result: KnowledgeAcquisitionResult | null;
  error: string | null;
}

class RecordingWikimediaProvider implements KnowledgeAcquisitionProvider {
  readonly kind = "diagnostic-recording-wikimedia";
  readonly calls: RecordedAcquisition[] = [];
  private readonly delegate = new WikimediaKnowledgeAcquisitionProvider();

  async acquire(request: KnowledgeAcquisitionRequest): Promise<KnowledgeAcquisitionResult> {
    const entry: RecordedAcquisition = {
      request: structuredClone(request),
      result: null,
      error: null,
    };
    this.calls.push(entry);
    try {
      const result = await this.delegate.acquire(request);
      entry.result = structuredClone(result);
      return result;
    } catch (error) {
      entry.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }
}

async function request(app: FastifyInstance, options: InjectOptions): Promise<Record<string, any>> {
  const response = await app.inject(options);
  assert.ok(response.statusCode >= 200 && response.statusCode < 300, response.body);
  return response.json<Record<string, any>>();
}

async function waitForOutcome(app: FastifyInstance, runId: string): Promise<Record<string, any>> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const run = await request(app, { method: "GET", url: `/api/v1/runs/${runId}` });
    if (run.status === "FAILED" || run.status === "CANCELLED") {
      throw new Error(`Run ${runId} reached ${String(run.status)}.`);
    }
    if (run.status === "COMPLETED") {
      return request(app, { method: "GET", url: `/api/v1/runs/${runId}/outcome` });
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`Run ${runId} did not complete within 60 seconds.`);
}

function compactCall(call: RecordedAcquisition, objective: string) {
  const qualifier = new ObjectiveKnowledgeRelevanceQualifier();
  const queries = call.request.investigationQueries ?? [];
  const sourceById = new Map((call.result?.sources ?? []).map((source) => [source.sourceId, source]));
  return {
    objective: call.request.objective,
    queries,
    error: call.error,
    sources: (call.result?.sources ?? []).map((source) => ({
      sourceId: source.sourceId,
      title: source.title,
      excerpt: source.content.replace(/\s+/gu, " ").trim().slice(0, 700),
    })),
    claims: (call.result?.claims ?? []).map((claim) => ({
      claimId: claim.claimId,
      claimType: claim.claimType,
      text: claim.text.replace(/\s+/gu, " ").trim().slice(0, 900),
      evidence: claim.evidence.map((evidence) => {
        const source = sourceById.get(evidence.sourceId);
        return {
          sourceId: evidence.sourceId,
          relevance: source
            ? qualifier.disposition({
              objective,
              context: call.request.context,
              queries,
              source,
              claim,
            })
            : null,
        };
      }),
    })),
  };
}

test("diagnostic: configured Solandra cognition drives semantically equivalent Knowledge investigation", { timeout: 240_000 }, async () => {
  const apiKey = process.env.GROQ_API_KEY;
  assert.ok(apiKey && apiKey.trim().length >= 16, "GROQ_API_KEY is required for this evidence-only diagnostic.");

  const config = resolveRuntimeConfig({
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-live",
    LATTICE_SOLANDRA_COGNITION_ROUTE: "groq-gpt-oss-120b",
    GROQ_API_KEY: apiKey,
  });
  const composition = createConfiguredSolandraCognition(config);
  assert.ok(composition, "Configured Solandra cognition must be available.");
  const provider = new RecordingWikimediaProvider();
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    knowledgeAcquisitionProvider: provider,
    solandraCognition: composition.cognition,
    solandraAdvisory: composition.advisory,
    solandraActionPreparer: composition.actionPreparer,
    solandraKnowledgePresenter: composition.knowledgePresenter,
  });

  try {
    for (const item of CASES) {
      const created = await request(app, { method: "POST", url: "/api/v1/conversations" });
      const conversationId = created.conversation.id as string;
      const before = provider.calls.length;
      const accepted = await request(app, {
        method: "POST",
        url: `/api/v1/conversations/${conversationId}/turns`,
        payload: { turnId: randomUUID(), message: item.message },
      });
      assert.equal(accepted.status, "RUN_ACCEPTED", JSON.stringify(accepted));
      const outcomeEnvelope = await waitForOutcome(app, accepted.runId as string);
      const calls = provider.calls.slice(before);
      const knowledgeNeeds = (accepted.interpretation?.knowledgeNeeds ?? []) as string[];
      const actualQueries = calls.flatMap((call) => call.request.investigationQueries ?? []);
      const trace = {
        id: item.id,
        pair: item.pair,
        userMessage: item.message,
        cognition: {
          authority: accepted.interpretation?.authority ?? null,
          objectiveRelation: accepted.interpretation?.objectiveRelation ?? null,
          proposedObjective: accepted.interpretation?.proposedObjective ?? null,
          requestedHelp: accepted.interpretation?.requestedHelp ?? null,
          entities: accepted.interpretation?.entities ?? [],
          knowledgeNeeds,
        },
        canonicalIntent: {
          acceptedUnderstanding: accepted.acceptedUnderstanding ?? null,
          intentVersionId: accepted.intentVersionId ?? null,
        },
        cognitionSuppliedInvestigationQueries: knowledgeNeeds,
        fallbackQueryDerivationUsed: knowledgeNeeds.length === 0 && actualQueries.length > 0,
        acquisition: calls.map((call) => compactCall(call, item.message)),
        v36AndKnowledge: {
          kind: outcomeEnvelope.outcome?.kind ?? null,
          findings: outcomeEnvelope.outcome?.findings ?? [],
          evidence: outcomeEnvelope.outcome?.evidence ?? [],
          provenance: outcomeEnvelope.outcome?.provenance ?? [],
          uncertainties: outcomeEnvelope.outcome?.uncertainties ?? [],
          truthAssessmentIds: outcomeEnvelope.outcome?.truthAssessmentIds ?? [],
        },
        visibleSolandraResponse: outcomeEnvelope.presentation?.assistantMessage ?? null,
      };
      console.log(`SOLANDRA_COGNITION_ALIGNMENT_TRACE=${JSON.stringify(trace)}`);

      assert.equal(accepted.acceptedUnderstanding, item.message);
      assert.equal(accepted.interpretation?.authority, "NON_AUTHORITATIVE_PROPOSAL");
      assert.equal(accepted.interpretation?.requestedHelp, "KNOWLEDGE");
      assert.ok(calls.length > 0, `Expected Knowledge acquisition for ${item.id}.`);
    }
  } finally {
    await app.close();
  }
});
