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
import type { ModelInvocationProvenance } from "../src/model/types.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import type {
  SolandraCognitionInput,
  SolandraCognitionResult,
  SolandraCognitiveRuntime,
  SolandraSemanticProposal,
} from "../src/solandra/cognition.js";

const CASE_A = "I need to know how to prepare my soil for sod.";
const CASE_B = "I need to know how to season a cast iron skillet.";
const EVIDENCE_FOLLOW_UP = "What evidence do you have?";
const UNSUPPORTED = "What exact steps guarantee that drinking 137 milliliters of water every morning will prevent every headache?";

const PROVENANCE: ModelInvocationProvenance = Object.freeze({
  executionClass: "LOCAL_OFFLINE",
  routeMode: "PINNED",
  requestedProvider: "procedural-live-proof-cognition",
  requestedModel: "procedural-live-proof-cognition",
  actualProvider: "procedural-live-proof-cognition",
  actualModel: "procedural-live-proof-cognition",
  brokerIdentity: null,
  brokerVersion: null,
  upstreamRequestId: "procedural-live-proof-cognition",
  routeProvenance: "COMPLETE",
});

function proposal(overrides: Partial<SolandraSemanticProposal>): SolandraSemanticProposal {
  return {
    objectiveRelation: "NEW_OBJECTIVE",
    proposedObjective: null,
    requestedHelp: "KNOWLEDGE",
    relevantContext: [],
    entities: [],
    referents: [],
    constraints: [],
    preferences: [],
    knowledgeNeeds: [],
    materialAmbiguity: null,
    referencedKnowledgeId: null,
    referencedRecommendationId: null,
    referencedOptionId: null,
    ...overrides,
  };
}

class ProceduralProofCognition implements SolandraCognitiveRuntime {
  async interpret(input: SolandraCognitionInput): Promise<SolandraCognitionResult> {
    if (input.message === EVIDENCE_FOLLOW_UP) {
      return {
        proposal: proposal({
          objectiveRelation: "CONTINUE",
          proposedObjective: null,
          requestedHelp: "SOURCES_REFERENCE",
          referencedKnowledgeId: input.governedKnowledge[0]?.knowledgeId ?? null,
        }),
        invocationProvenance: PROVENANCE,
      };
    }
    return {
      proposal: proposal({
        objectiveRelation: input.currentObjective === undefined ? "NEW_OBJECTIVE" : "NEW_OBJECTIVE",
        proposedObjective: input.message,
        requestedHelp: "KNOWLEDGE",
        knowledgeNeeds: [],
      }),
      invocationProvenance: PROVENANCE,
    };
  }
}

type RecordedAcquisition = {
  objective: string;
  queries: string[];
  result: KnowledgeAcquisitionResult | null;
  error: string | null;
};

class RecordingLiveProvider implements KnowledgeAcquisitionProvider {
  readonly kind = "procedural-live-proof:realtime-wikimedia";
  readonly calls: RecordedAcquisition[] = [];
  private readonly delegate = new WikimediaKnowledgeAcquisitionProvider();

  async acquire(request: KnowledgeAcquisitionRequest): Promise<KnowledgeAcquisitionResult> {
    const entry: RecordedAcquisition = {
      objective: request.objective,
      queries: [...(request.investigationQueries ?? [])],
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
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Run ${runId} did not complete within 45 seconds.`);
}

async function submitKnowledgeTurn(app: FastifyInstance, conversationId: string, message: string): Promise<any> {
  const accepted = await request(app, {
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/turns`,
    payload: { turnId: randomUUID(), message },
  });
  assert.equal(accepted.status, "RUN_ACCEPTED");
  assert.equal(accepted.acceptedUnderstanding, message);
  assert.equal(accepted.decisionNeed, "NONE");
  assert.equal(accepted.interpretation?.authority, "NON_AUTHORITATIVE_PROPOSAL");
  assert.equal(accepted.interpretation?.requestedHelp, "KNOWLEDGE");
  const envelope = await waitForOutcome(app, accepted.runId as string);
  assert.equal(envelope.outcome.kind, "KNOWLEDGE");
  return { accepted, envelope };
}

function assertUsefulProceduralKnowledge(
  result: any,
  nounPattern: RegExp,
  actionPattern: RegExp,
): void {
  const outcome = result.envelope.outcome;
  const assistantMessage = result.envelope.presentation?.assistantMessage ?? "";
  assert.ok(outcome.findings.length > 0, "Expected governed Knowledge findings.");
  assert.ok(outcome.evidence.length > 0, "Expected governed source evidence.");
  assert.ok(outcome.provenance.length > 0, "Expected governed provenance.");
  assert.ok(outcome.findings.some((finding: any) => nounPattern.test(finding.text ?? "") && actionPattern.test(finding.text ?? "")),
    "Expected at least one governed finding to contain materially responsive procedural content.");
  assert.doesNotMatch(assistantMessage, /couldn't establish enough relevant evidence/iu);
  assert.match(assistantMessage, nounPattern);
  assert.match(assistantMessage, actionPattern);
}

test("frozen procedural Knowledge candidate crosses the live source-backed Product path", { timeout: 240_000 }, async () => {
  const config = resolveRuntimeConfig({
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-live",
  });
  const provider = new RecordingLiveProvider();
  const cognition = new ProceduralProofCognition();
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    knowledgeAcquisitionProvider: provider,
    solandraCognition: cognition,
  });
  const report: any = { candidateParent: "72d75b821c907e7bb408e93344fd455a9e7ed5f4", cases: [] };

  try {
    const created = await request(app, { method: "POST", url: "/api/v1/conversations" });
    const conversationId = created.conversation.id as string;

    const aStart = provider.calls.length;
    const a = await submitKnowledgeTurn(app, conversationId, CASE_A);
    const aCalls = provider.calls.slice(aStart);
    assert.ok(aCalls.length > 0 && aCalls.every((call) => call.error === null), "Expected successful live acquisition for Case A.");
    assert.ok(aCalls.every((call) => call.objective === CASE_A), "Case A acquisition must preserve the exact USER objective.");
    assert.ok(aCalls.flatMap((call) => call.queries).some((query) => /prepare/iu.test(query) && /soil/iu.test(query) && /sod/iu.test(query)));
    assert.ok(aCalls.flatMap((call) => call.queries).every((query) => !/\bneed\b/iu.test(query)));
    assertUsefulProceduralKnowledge(a, /soil|sod|turf/iu, /prepar|dig|stir|overturn|loosen|till|plant|cultivat/iu);

    const aKnowledgeId = a.envelope.knowledgeReference?.knowledgeId as string;
    assert.ok(aKnowledgeId);
    const aSourceUris = a.envelope.outcome.provenance.map((source: any) => source.canonicalUri).sort();
    const beforeEvidenceFollowupCalls = provider.calls.length;
    const evidenceA = await request(app, {
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: randomUUID(), message: EVIDENCE_FOLLOW_UP },
    });
    assert.equal(evidenceA.status, "REFERENCE_RESOLVED");
    assert.equal(evidenceA.acceptedUnderstanding, CASE_A);
    assert.equal(evidenceA.knowledgeReference?.knowledgeId, aKnowledgeId);
    assert.equal(provider.calls.length, beforeEvidenceFollowupCalls, "Historical evidence follow-up must not reacquire sources.");
    assert.deepEqual((evidenceA.knowledge?.provenance ?? []).map((source: any) => source.canonicalUri).sort(), aSourceUris);

    const bStart = provider.calls.length;
    const b = await submitKnowledgeTurn(app, conversationId, CASE_B);
    assert.notEqual(b.accepted.intentVersionId, a.accepted.intentVersionId, "Unrelated procedural topic must create a new IntentVersion.");
    const bCalls = provider.calls.slice(bStart);
    assert.ok(bCalls.length > 0 && bCalls.every((call) => call.error === null), "Expected successful live acquisition for Case B.");
    assert.ok(bCalls.every((call) => call.objective === CASE_B), "Case B acquisition must bind to the new exact USER objective.");
    assert.ok(bCalls.flatMap((call) => call.queries).some((query) => /season/iu.test(query) && /cast/iu.test(query) && /iron/iu.test(query) && /skillet/iu.test(query)));
    assertUsefulProceduralKnowledge(b, /cast|iron|skillet|cookware|season/iu, /clean|coat|oil|fat|heat|bake|season/iu);

    const bKnowledgeId = b.envelope.knowledgeReference?.knowledgeId as string;
    assert.ok(bKnowledgeId);
    const continuity = await request(app, {
      method: "GET",
      url: `/api/v1/conversations/${conversationId}/continuity`,
    });
    assert.ok(continuity.knowledge.some((item: any) => item.knowledgeId === bKnowledgeId && item.objective === CASE_B),
      "Recovered Conversation must retain the current procedural Knowledge under Case B.");
    assert.equal(continuity.messages.at(-1)?.content, CASE_B);

    const bSourceUris = b.envelope.outcome.provenance.map((source: any) => source.canonicalUri).sort();
    const beforeReloadEvidenceCalls = provider.calls.length;
    const evidenceB = await request(app, {
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: randomUUID(), message: EVIDENCE_FOLLOW_UP },
    });
    assert.equal(evidenceB.status, "REFERENCE_RESOLVED");
    assert.equal(evidenceB.acceptedUnderstanding, CASE_B);
    assert.equal(evidenceB.knowledgeReference?.knowledgeId, bKnowledgeId);
    assert.equal(provider.calls.length, beforeReloadEvidenceCalls, "Recovered evidence follow-up must reuse historical Knowledge.");
    assert.deepEqual((evidenceB.knowledge?.provenance ?? []).map((source: any) => source.canonicalUri).sort(), bSourceUris);

    const unsupportedStart = provider.calls.length;
    const unsupported = await submitKnowledgeTurn(app, conversationId, UNSUPPORTED);
    const unsupportedCalls = provider.calls.slice(unsupportedStart);
    const unsupportedMessage = unsupported.envelope.presentation?.assistantMessage ?? "";
    const unsupportedFindings = unsupported.envelope.outcome.findings;
    assert.ok(unsupportedCalls.length > 0, "Unsupported case should still use the ordinary Knowledge acquisition path.");
    assert.ok(
      unsupportedFindings.length === 0
      || unsupportedFindings.every((finding: any) => finding.status !== "SUPPORTED"),
      "Unsupported guarantee must not become supported Knowledge.",
    );
    assert.doesNotMatch(unsupportedMessage, /guarantee(?:s|d)? that .*prevent every headache/iu);
    if (unsupportedFindings.length > 0) {
      assert.match(unsupportedMessage, /does not by itself|couldn't establish|not independently verify|uncertain|unresolved/iu);
    }

    report.cases.push(
      {
        userMessage: CASE_A,
        acceptedUnderstanding: a.accepted.acceptedUnderstanding,
        intentVersionId: a.accepted.intentVersionId,
        queries: aCalls.flatMap((call) => call.queries),
        acquiredSources: aCalls.flatMap((call) => call.result?.sources ?? []).map((source) => ({ title: source.title, canonicalUri: source.canonicalUri })),
        findings: a.envelope.outcome.findings.map((finding: any) => ({ status: finding.status, text: finding.text.slice(0, 700) })),
        provenance: a.envelope.outcome.provenance,
        assistantMessage: a.envelope.presentation?.assistantMessage ?? null,
        evidenceFollowup: evidenceA.presentation?.assistantMessage ?? null,
        evidenceFollowupReacquired: provider.calls.length !== beforeEvidenceFollowupCalls,
      },
      {
        userMessage: CASE_B,
        acceptedUnderstanding: b.accepted.acceptedUnderstanding,
        intentVersionId: b.accepted.intentVersionId,
        queries: bCalls.flatMap((call) => call.queries),
        acquiredSources: bCalls.flatMap((call) => call.result?.sources ?? []).map((source) => ({ title: source.title, canonicalUri: source.canonicalUri })),
        findings: b.envelope.outcome.findings.map((finding: any) => ({ status: finding.status, text: finding.text.slice(0, 700) })),
        provenance: b.envelope.outcome.provenance,
        assistantMessage: b.envelope.presentation?.assistantMessage ?? null,
        recoveredKnowledgeId: bKnowledgeId,
        evidenceAfterRecovery: evidenceB.presentation?.assistantMessage ?? null,
      },
      {
        userMessage: UNSUPPORTED,
        acceptedUnderstanding: unsupported.accepted.acceptedUnderstanding,
        queries: unsupportedCalls.flatMap((call) => call.queries),
        findings: unsupportedFindings.map((finding: any) => ({ status: finding.status, text: finding.text.slice(0, 700) })),
        assistantMessage: unsupportedMessage,
      },
    );
    console.log(`PROCEDURAL_KNOWLEDGE_LIVE_PROOF=${JSON.stringify(report)}`);
  } finally {
    await app.close();
  }
});
