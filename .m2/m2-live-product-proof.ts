import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRuntimeApp } from "../../product/src/runtime-app.js";
import { resolveRuntimeConfig } from "../../product/src/runtime-config.js";
import { createConfiguredSolandraCognition } from "../../product/src/solandra/cognition-composition.js";
import { KnowledgeAcquisitionTruthPipeline } from "../../product/src/truth/knowledge-acquisition-pipeline.js";
import type {
  KnowledgeAcquisitionProvider,
  KnowledgeAcquisitionRequest,
  KnowledgeAcquisitionResult,
} from "../../product/src/knowledge/acquisition.js";
import type { SolandraCognitionInput, SolandraCognitionResult, SolandraCognitiveRuntime } from "../../product/src/solandra/cognition.js";
import type { SolandraAdvisoryInput, SolandraAdvisoryRuntime, SolandraAdvisoryRuntimeResult } from "../../product/src/solandra/advisory.js";

const USER = "Help me choose between Approach Alpha and Approach Beta. My priority is minimizing ongoing maintenance effort. Use the available evidence and give me a recommendation; I am not authorizing any action.";
const FINDING = "Within this qualification fixture, Approach Alpha requires one recurring maintenance step per cycle while Approach Beta requires three recurring maintenance steps per cycle.";
const FIXED_TIME = "2026-09-07T17:20:00.000Z";

class QualificationAcquisition implements KnowledgeAcquisitionProvider {
  readonly kind = "m2-live-product-proof-acquisition";
  readonly requests: KnowledgeAcquisitionRequest[] = [];

  async acquire(request: KnowledgeAcquisitionRequest): Promise<KnowledgeAcquisitionResult> {
    this.requests.push(structuredClone(request));
    return {
      sources: [{
        sourceId: "m2-live-product-proof-source",
        canonicalUri: "https://m2.example/live-product-proof",
        title: "M2 live Product proof synthetic maintenance comparison",
        publisher: "Lattice qualification fixture",
        retrievedAt: FIXED_TIME,
        publishedAt: null,
        contentType: "text/plain",
        content: `${FINDING} This is synthetic qualification evidence and does not describe a real product.`,
      }],
      claims: [{
        claimId: "m2-live-product-proof-claim",
        text: FINDING,
        claimType: "INTERPRETIVE",
        evidence: [{
          sourceId: "m2-live-product-proof-source",
          relation: "SUPPORTS",
          excerpt: FINDING,
        }],
      }],
    };
  }
}

class RecordingCognition implements SolandraCognitiveRuntime {
  readonly records: Array<{ input: SolandraCognitionInput; output: SolandraCognitionResult }> = [];
  constructor(private readonly delegate: SolandraCognitiveRuntime) {}
  async interpret(input: SolandraCognitionInput): Promise<SolandraCognitionResult> {
    const output = await this.delegate.interpret(input);
    this.records.push({ input: structuredClone(input), output: structuredClone(output) });
    return output;
  }
}

class RecordingAdvisory implements SolandraAdvisoryRuntime {
  readonly records: Array<{ input: SolandraAdvisoryInput; output: SolandraAdvisoryRuntimeResult }> = [];
  constructor(private readonly delegate: SolandraAdvisoryRuntime) {}
  async advise(input: SolandraAdvisoryInput): Promise<SolandraAdvisoryRuntimeResult> {
    const output = await this.delegate.advise(input);
    this.records.push({ input: structuredClone(input), output: structuredClone(output) });
    return output;
  }
}

async function waitForRun(app: Awaited<ReturnType<typeof createRuntimeApp>>, runId: string): Promise<void> {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const response = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}` });
    assert.equal(response.statusCode, 200, response.body);
    const status = response.json<{ status: string }>().status;
    if (status === "COMPLETED") return;
    if (status === "FAILED" || status === "CANCELLED") throw new Error(`Product Run reached ${status}.`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timed out waiting for the Product Run to complete.");
}

async function waitForOutcome(app: Awaited<ReturnType<typeof createRuntimeApp>>, runId: string) {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const response = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}/outcome` });
    if (response.statusCode === 202) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }
    assert.equal(response.statusCode, 200, response.body);
    return response;
  }
  throw new Error("Timed out waiting for the Product advisory outcome.");
}

assert.ok(process.env.GROQ_API_KEY, "GROQ_API_KEY is required for the configured live Product proof.");
const config = resolveRuntimeConfig({
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-live",
  LATTICE_SOLANDRA_COGNITION_ROUTE: "groq-gpt-oss-120b",
  LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "m2-live-product-proof-user",
  GROQ_API_KEY: process.env.GROQ_API_KEY,
} as NodeJS.ProcessEnv);
const configured = createConfiguredSolandraCognition(config);
assert.ok(configured);
const cognition = new RecordingCognition(configured.cognition);
const advisory = new RecordingAdvisory(configured.advisory);
const acquisition = new QualificationAcquisition();
const app = await createRuntimeApp(config, {
  memoryDispatchDelayMs: 1,
  truthPipeline: new KnowledgeAcquisitionTruthPipeline(acquisition),
  solandraCognition: cognition,
  solandraAdvisory: advisory,
  solandraKnowledgePresenter: configured.knowledgePresenter,
});

try {
  const conversationResponse = await app.inject({ method: "POST", url: "/api/v1/conversations" });
  assert.equal(conversationResponse.statusCode, 201, conversationResponse.body);
  const conversationId = conversationResponse.json<{ conversation: { id: string } }>().conversation.id;

  const turn = await app.inject({
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/turns`,
    payload: { turnId: randomUUID(), message: USER },
  });
  assert.equal(turn.statusCode, 202, turn.body);
  const accepted = turn.json<{
    status: string;
    runId: string;
    acceptedUnderstanding: string;
    intentVersionId: string;
    interpretation: { authority: string; requestedHelp: string; knowledgeNeeds: string[] };
  }>();
  assert.equal(accepted.status, "RUN_ACCEPTED");
  assert.equal(accepted.acceptedUnderstanding, USER);
  assert.equal(accepted.interpretation.authority, "NON_AUTHORITATIVE_PROPOSAL");
  assert.equal(accepted.interpretation.requestedHelp, "DECISION");
  assert.ok(accepted.interpretation.knowledgeNeeds.length > 0);

  await waitForRun(app, accepted.runId);
  const outcomeResponse = await waitForOutcome(app, accepted.runId);
  const outcome = outcomeResponse.json<{
    recommendationReference?: {
      recommendationId: string;
      intentVersionId: string;
      knowledgeIds: string[];
      claimIds: string[];
      selectionAuthorized: boolean;
    };
    presentation: { assistantMessage: string };
  }>();
  assert.ok(outcome.recommendationReference, outcomeResponse.body);
  assert.equal(outcome.recommendationReference.intentVersionId, accepted.intentVersionId);
  assert.equal(outcome.recommendationReference.selectionAuthorized, false);
  assert.ok(outcome.recommendationReference.knowledgeIds.length > 0);
  assert.ok(outcome.recommendationReference.claimIds.length > 0);
  assert.doesNotMatch(outcome.presentation.assistantMessage, /provider|model ID|workflow|stage/iu);

  const recommendationResponse = await app.inject({
    method: "GET",
    url: `/api/v1/recommendations/${outcome.recommendationReference.recommendationId}`,
  });
  assert.equal(recommendationResponse.statusCode, 200, recommendationResponse.body);
  const recommendation = recommendationResponse.json<{
    runId: string;
    intentVersionId: string;
    basis: Array<{ knowledgeId: string; claimIds: string[] }>;
    factualBasis: Array<{ knowledgeId: string; claimIds: string[]; evidenceIds: string[]; sourceIds: string[] }>;
    selectionAuthorized: boolean;
  }>();
  assert.equal(recommendation.runId, accepted.runId);
  assert.equal(recommendation.intentVersionId, accepted.intentVersionId);
  assert.equal(recommendation.selectionAuthorized, false);
  assert.ok(recommendation.basis.length > 0);
  assert.ok(recommendation.factualBasis.every((entry) => entry.claimIds.length > 0 && entry.evidenceIds.length > 0 && entry.sourceIds.length > 0));
  assert.ok(acquisition.requests.length >= 1);
  assert.ok(cognition.records.length >= 1);
  assert.ok(advisory.records.length >= 1);
  const finalAdvisory = advisory.records.at(-1)!;
  assert.equal(finalAdvisory.output.result.status, "RECOMMENDATION");
  assert.equal(finalAdvisory.output.invocationProvenance.actualProvider, "groq");
  assert.equal(finalAdvisory.output.invocationProvenance.actualModel, "openai/gpt-oss-120b");
  assert.equal(finalAdvisory.output.invocationProvenance.routeMode, "PINNED");
  assert.equal(finalAdvisory.output.invocationProvenance.routeProvenance, "COMPLETE");

  console.log(`LIVE_PRODUCT_PROOF=PASS sha=716728c2312265ea9e67038b485e435d0d4915d9 tree=93443ec2a90f11158debc056d8881be9e2e52950`);
  console.log(`LIVE_COGNITION_CALLS=${cognition.records.length}`);
  console.log(`LIVE_ADVISORY_CALLS=${advisory.records.length}`);
  console.log(`LIVE_ACQUISITION_CALLS=${acquisition.requests.length}`);
  console.log(`LIVE_ADVISORY_PROVENANCE=${JSON.stringify(finalAdvisory.output.invocationProvenance)}`);
  console.log(`LIVE_RECOMMENDATION_BASIS=${JSON.stringify(recommendation.basis)}`);
  console.log(`LIVE_RECOMMENDATION_FACTUAL_BASIS=${JSON.stringify(recommendation.factualBasis)}`);
  console.log(`LIVE_PRESENTATION=${JSON.stringify(outcome.presentation.assistantMessage)}`);
} finally {
  await app.close();
}
