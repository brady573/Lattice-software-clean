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
const CANDIDATE = "0e9178268fc9b0e773b2c62bd5374785a89c27a3";

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

async function request(app: FastifyInstance, options: InjectOptions): Promise<Record<string, any>> {
  const response = await app.inject(options);
  assert.ok(response.statusCode >= 200 && response.statusCode < 300, response.body);
  return response.json<Record<string, any>>();
}

async function waitForOutcome(app: FastifyInstance, runId: string): Promise<Record<string, any>> {
  const deadline = Date.now() + 45_000;
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
    claims: (call.result?.claims ?? []).map((claim) => ({
      claimId: claim.claimId,
      claimType: claim.claimType,
      text: claim.text.replace(/\s+/gu, " ").trim().slice(0, 1200),
      evidence: claim.evidence,
    })),
  };
}

function sentences(value: string): string[] {
  return value.match(/[^.!?\n]+(?:[.!?]+|$)/gu)?.map((item) => item.trim()).filter(Boolean) ?? [];
}

test("frozen procedural candidate gives the Owner useful bounded governed sod guidance and historical evidence", { timeout: 120_000 }, async () => {
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

    const primaryReport = {
      candidate: CANDIDATE,
      userRequest: OWNER_REQUEST,
      acceptedUnderstanding: accepted.acceptedUnderstanding ?? null,
      intentVersionId: accepted.intentVersionId ?? null,
      acquisitions: provider.calls.map(compactAcquisition),
      outcome: {
        kind: outcomeEnvelope.outcome?.kind ?? null,
        findings: outcomeEnvelope.outcome?.findings ?? [],
        evidence: outcomeEnvelope.outcome?.evidence ?? [],
        provenance: outcomeEnvelope.outcome?.provenance ?? [],
        uncertainties: outcomeEnvelope.outcome?.uncertainties ?? [],
      },
      visibleSolandraResponse: outcomeEnvelope.presentation?.assistantMessage ?? null,
    };
    console.log(`PROCEDURAL_KNOWLEDGE_PRIMARY=${JSON.stringify(primaryReport)}`);

    assert.equal(accepted.acceptedUnderstanding, OWNER_REQUEST);
    assert.equal(accepted.decisionNeed, "NONE");
    assert.ok(provider.calls.length > 0, "Expected the ordinary Knowledge path to acquire information.");
    assert.ok(provider.calls.every((call) => call.error === null), "Expected live Wikimedia acquisition to return normally.");
    assert.ok(provider.calls.every((call) => call.request.objective === OWNER_REQUEST), "Acquisition must preserve the authoritative objective.");
    assert.ok(
      provider.calls.flatMap((call) => call.request.investigationQueries ?? [])
        .some((query) => /prepare/iu.test(query) && /soil/iu.test(query) && /sod/iu.test(query)),
      "Expected task-specific investigation for the Owner request.",
    );

    assert.equal(outcomeEnvelope.outcome?.kind, "KNOWLEDGE");
    const findings = (outcomeEnvelope.outcome?.findings ?? []) as Array<Record<string, any>>;
    assert.ok(findings.length > 0, "Expected governed Knowledge findings.");
    assert.ok((outcomeEnvelope.outcome?.evidence ?? []).length > 0, "Expected governed evidence.");
    assert.ok((outcomeEnvelope.outcome?.provenance ?? []).length > 0, "Expected governed provenance.");
    const sourceReport = findings.find((finding) => finding.basis === "SOURCE_REPORT" && (finding.evidenceIds?.length ?? 0) > 0);
    assert.ok(sourceReport, "Expected an admitted source-report finding.");
    const governedSentences = sentences(String(sourceReport.text ?? ""));
    assert.ok(governedSentences.length >= 2, "Expected the governed source report to contain more than a definition-only sentence.");

    const assistantMessage = String(outcomeEnvelope.presentation?.assistantMessage ?? "");
    assert.ok(assistantMessage.includes(governedSentences[0]!), "Visible answer must faithfully expose the first governed source-report sentence.");
    assert.ok(assistantMessage.includes(governedSentences[1]!), "Visible answer must not discard the next bounded governed procedural sentence.");
    assert.match(assistantMessage, /prepar|dig|stir|overturn|shovel|hoe|rake|plough|rototill|smooth|seedbed|loosen|turn/iu);
    assert.match(assistantMessage, /does not by itself independently verify the broader real-world claim/iu);
    assert.doesNotMatch(assistantMessage, /V36|run state|retrieval mode|investigation quer|proof obligation/iu);

    const beforeEvidenceCalls = provider.calls.length;
    const evidenceFollowUp = await request(app, {
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: randomUUID(), message: EVIDENCE_FOLLOW_UP },
    });
    const evidenceReport = {
      status: evidenceFollowUp.status ?? null,
      acceptedUnderstanding: evidenceFollowUp.acceptedUnderstanding ?? null,
      knowledgeReference: evidenceFollowUp.knowledgeReference ?? null,
      visibleSolandraResponse: evidenceFollowUp.presentation?.assistantMessage ?? null,
      provenance: evidenceFollowUp.knowledge?.provenance ?? [],
      reacquired: provider.calls.length !== beforeEvidenceCalls,
    };
    console.log(`PROCEDURAL_KNOWLEDGE_EVIDENCE_FOLLOW_UP=${JSON.stringify(evidenceReport)}`);

    assert.equal(evidenceFollowUp.status, "REFERENCE_RESOLVED");
    assert.equal(evidenceFollowUp.acceptedUnderstanding, OWNER_REQUEST);
    assert.equal(provider.calls.length, beforeEvidenceCalls, "Historical evidence follow-up must not reacquire information.");
    assert.match(String(evidenceFollowUp.presentation?.assistantMessage ?? ""), /Sources I used:/u);
    assert.deepEqual(
      (evidenceFollowUp.knowledge?.provenance ?? []).map((source: Record<string, any>) => source.canonicalUri).sort(),
      (outcomeEnvelope.outcome?.provenance ?? []).map((source: Record<string, any>) => source.canonicalUri).sort(),
    );
  } finally {
    await app.close();
  }
});
