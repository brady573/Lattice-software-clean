import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { FastifyInstance, InjectOptions } from "fastify";
import type {
  KnowledgeAcquisitionProvider,
  KnowledgeAcquisitionRequest,
  KnowledgeAcquisitionResult,
} from "../src/knowledge/acquisition.js";
import { WikimediaKnowledgeAcquisitionProvider } from "../src/knowledge/wikimedia-acquisition.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";

const OWNER_REQUEST = "I need to know how to prepare my soil for sod.";
const EVIDENCE_FOLLOW_UP = "What evidence do you have?";
const CANDIDATE = "09a7a1c111f02de86798a46e013184eb5de64e18";

interface RecordedAcquisition {
  request: KnowledgeAcquisitionRequest;
  result: KnowledgeAcquisitionResult | null;
  error: string | null;
}

class RecordingWikimediaProvider implements KnowledgeAcquisitionProvider {
  readonly kind = "procedural-e2e-recording-wikimedia";
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

async function request(app: FastifyInstance, options: InjectOptions): Promise<any> {
  const response = await app.inject(options);
  assert.ok(response.statusCode >= 200 && response.statusCode < 300, response.body);
  return response.json();
}

async function waitForOutcome(app: FastifyInstance, runId: string): Promise<any> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const run = await request(app, { method: "GET", url: `/api/v1/runs/${runId}` });
    if (run.status === "FAILED" || run.status === "CANCELLED") {
      throw new Error(`Run ${runId} reached ${run.status}.`);
    }
    if (run.status === "COMPLETED") {
      return request(app, { method: "GET", url: `/api/v1/runs/${runId}/outcome` });
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`Run ${runId} did not complete within 45 seconds.`);
}

function compactAcquisition(call: RecordedAcquisition) {
  return {
    objective: call.request.objective,
    queries: call.request.investigationQueries ?? [],
    error: call.error,
    sources: (call.result?.sources ?? []).map((source) => ({
      title: source.title,
      canonicalUri: source.canonicalUri,
      excerpt: source.content.replace(/\s+/gu, " ").trim().slice(0, 900),
    })),
  };
}

test("frozen procedural candidate gives the Owner useful governed sod guidance and historical evidence", { timeout: 120_000 }, async () => {
  const config = resolveRuntimeConfig({
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-live",
  });
  const provider = new RecordingWikimediaProvider();
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    knowledgeAcquisitionProvider: provider,
  });

  try {
    const created = await request(app, { method: "POST", url: "/api/v1/conversations" });
    const conversationId = created.conversation.id as string;

    const accepted = await request(app, {
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: randomUUID(), message: OWNER_REQUEST },
    });
    assert.equal(accepted.status, "RUN_ACCEPTED");
    const outcomeEnvelope = await waitForOutcome(app, accepted.runId as string);

    const beforeEvidenceCalls = provider.calls.length;
    const evidenceFollowUp = await request(app, {
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: randomUUID(), message: EVIDENCE_FOLLOW_UP },
    });

    const report = {
      candidate: CANDIDATE,
      userRequest: OWNER_REQUEST,
      acceptedUnderstanding: accepted.acceptedUnderstanding ?? null,
      intentVersionId: accepted.intentVersionId ?? null,
      interpretation: accepted.interpretation ?? null,
      acquisitions: provider.calls.map(compactAcquisition),
      outcome: {
        kind: outcomeEnvelope.outcome?.kind ?? null,
        findings: outcomeEnvelope.outcome?.findings ?? [],
        evidence: outcomeEnvelope.outcome?.evidence ?? [],
        provenance: outcomeEnvelope.outcome?.provenance ?? [],
        uncertainties: outcomeEnvelope.outcome?.uncertainties ?? [],
      },
      visibleSolandraResponse: outcomeEnvelope.presentation?.assistantMessage ?? null,
      evidenceFollowUp: {
        status: evidenceFollowUp.status ?? null,
        acceptedUnderstanding: evidenceFollowUp.acceptedUnderstanding ?? null,
        knowledgeReference: evidenceFollowUp.knowledgeReference ?? null,
        visibleSolandraResponse: evidenceFollowUp.presentation?.assistantMessage ?? null,
        provenance: evidenceFollowUp.knowledge?.provenance ?? [],
        reacquired: provider.calls.length !== beforeEvidenceCalls,
      },
    };
    console.log(`PROCEDURAL_KNOWLEDGE_E2E=${JSON.stringify(report)}`);

    assert.equal(accepted.acceptedUnderstanding, OWNER_REQUEST);
    assert.equal(accepted.decisionNeed, "NONE");
    assert.equal(accepted.interpretation?.authority, "NON_AUTHORITATIVE_PROPOSAL");
    assert.ok(provider.calls.length > 0, "Expected the ordinary Knowledge path to acquire information.");
    assert.ok(provider.calls.every((call) => call.error === null), "Expected live Wikimedia acquisition to return normally.");
    assert.ok(provider.calls.every((call) => call.request.objective === OWNER_REQUEST), "Acquisition must preserve the authoritative objective.");
    assert.ok(
      provider.calls.flatMap((call) => call.request.investigationQueries ?? [])
        .some((query) => /prepare/iu.test(query) && /soil/iu.test(query) && /sod/iu.test(query)),
      "Expected task-specific investigation for the Owner request.",
    );

    assert.equal(outcomeEnvelope.outcome?.kind, "KNOWLEDGE");
    assert.ok((outcomeEnvelope.outcome?.findings ?? []).length > 0, "Expected governed Knowledge findings.");
    assert.ok((outcomeEnvelope.outcome?.evidence ?? []).length > 0, "Expected governed evidence.");
    assert.ok((outcomeEnvelope.outcome?.provenance ?? []).length > 0, "Expected governed provenance.");

    const assistantMessage = outcomeEnvelope.presentation?.assistantMessage ?? "";
    assert.doesNotMatch(assistantMessage, /couldn't establish enough relevant evidence/iu);
    assert.match(assistantMessage, /soil|sod|turf|tillage/iu);
    assert.match(assistantMessage, /prepar|dig|stir|overturn|loosen|till|plant|cultivat/iu);
    assert.doesNotMatch(assistantMessage, /V36|run state|retrieval mode|investigation quer/iu);

    assert.equal(evidenceFollowUp.status, "REFERENCE_RESOLVED");
    assert.equal(evidenceFollowUp.acceptedUnderstanding, OWNER_REQUEST);
    assert.equal(provider.calls.length, beforeEvidenceCalls, "Historical evidence follow-up must not reacquire information.");
    assert.deepEqual(
      (evidenceFollowUp.knowledge?.provenance ?? []).map((source: any) => source.canonicalUri).sort(),
      (outcomeEnvelope.outcome?.provenance ?? []).map((source: any) => source.canonicalUri).sort(),
    );
  } finally {
    await app.close();
  }
});
