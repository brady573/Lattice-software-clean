import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import type {
  KnowledgeAcquisitionProvider,
  KnowledgeAcquisitionRequest,
  KnowledgeAcquisitionResult,
} from "../src/knowledge/acquisition.js";
import { DeterministicFixtureModelProvider } from "../src/model/fixture-provider.js";
import { ModelRuntime } from "../src/model/runtime.js";
import type { KnowledgeFinding, KnowledgeOutcome } from "../src/outcome.js";
import {
  buildKnowledgeSimplificationRequest,
  ModelKnowledgeSimplifier,
  validateKnowledgeSimplification,
  type KnowledgeSimplificationInput,
  type KnowledgeSimplifier,
} from "../src/presentation/solandra/knowledge-simplification.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";

const FIXED_TIME = "2026-09-06T13:00:00.000Z";
const TECHNICAL_ORIGINAL =
  "C4 photosynthesis spatially separates initial carbon fixation from the Calvin cycle, which may reduce photorespiration under hot, dry conditions.";
const TECHNICAL_SIMPLIFIED =
  "In C4 photosynthesis, plants first capture carbon separately from the Calvin cycle. This may reduce photorespiration when conditions are hot and dry.";

function finding(overrides: Partial<KnowledgeFinding> = {}): KnowledgeFinding {
  return {
    claimId: "claim-c4",
    text: TECHNICAL_ORIGINAL,
    status: "UNRESOLVED",
    confidence: "LOW",
    evidenceIds: ["evidence-c4"],
    contradictoryEvidenceIds: [],
    temporalQualifiers: { effectiveAt: null, period: null },
    basis: "SOURCE_REPORT",
    ...overrides,
  };
}

class SingleFindingProvider implements KnowledgeAcquisitionProvider {
  readonly kind = "single-finding-source";
  readonly requests: KnowledgeAcquisitionRequest[] = [];

  async acquire(request: KnowledgeAcquisitionRequest): Promise<KnowledgeAcquisitionResult> {
    this.requests.push(structuredClone(request));
    return {
      sources: [{
        sourceId: "source-c4",
        canonicalUri: "https://knowledge.example/c4",
        title: "C4 source",
        publisher: "Knowledge Example",
        retrievedAt: FIXED_TIME,
        publishedAt: "2026-08-15T00:00:00.000Z",
        contentType: "text/plain",
        content: TECHNICAL_ORIGINAL,
      }],
      claims: [{
        claimId: "claim-c4",
        text: TECHNICAL_ORIGINAL,
        claimType: "INTERPRETIVE",
        evidence: [{
          sourceId: "source-c4",
          relation: "SUPPORTS",
          excerpt: TECHNICAL_ORIGINAL,
        }],
      }],
    };
  }
}

class RecordingSimplifier implements KnowledgeSimplifier {
  readonly inputs: KnowledgeSimplificationInput[] = [];

  async simplify(input: KnowledgeSimplificationInput): Promise<string | null> {
    this.inputs.push(structuredClone(input));
    return TECHNICAL_SIMPLIFIED;
  }
}

async function waitForCompletedRun(app: FastifyInstance, runId: string): Promise<void> {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const response = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}` });
    assert.equal(response.statusCode, 200, response.body);
    const status = response.json<{ status: string }>().status;
    if (status === "COMPLETED") return;
    if (status === "FAILED" || status === "CANCELLED") {
      throw new Error(`Run ${runId} reached ${status}.`);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 5));
  }
  throw new Error(`Run ${runId} did not complete.`);
}

async function createConversation(app: FastifyInstance): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/conversations" });
  assert.equal(response.statusCode, 201, response.body);
  return response.json<{ conversation: { id: string } }>().conversation.id;
}

async function ask(app: FastifyInstance, conversationId: string, turnId: string, message: string) {
  const acceptedResponse = await app.inject({
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/turns`,
    payload: { turnId, message },
  });
  assert.equal(acceptedResponse.statusCode, 202, acceptedResponse.body);
  const accepted = acceptedResponse.json<{
    runId: string;
    intentVersionId: string;
    acceptedUnderstanding: string;
  }>();
  await waitForCompletedRun(app, accepted.runId);
  const outcomeResponse = await app.inject({
    method: "GET",
    url: `/api/v1/runs/${accepted.runId}/outcome`,
  });
  assert.equal(outcomeResponse.statusCode, 200, outcomeResponse.body);
  return {
    accepted,
    body: outcomeResponse.json<{
      outcome: KnowledgeOutcome;
      presentation: { assistantMessage: string };
    }>(),
  };
}

test("technical/scientific simplification may improve wording while preserving uncertainty and condition markers", () => {
  assert.equal(
    validateKnowledgeSimplification(TECHNICAL_ORIGINAL, TECHNICAL_SIMPLIFIED),
    TECHNICAL_SIMPLIFIED,
  );
});

test("negation or uncertainty cannot be silently strengthened away", () => {
  const negated = "The available evidence does not establish that X causes Y.";
  assert.equal(
    validateKnowledgeSimplification(negated, "The evidence shows that X causes Y."),
    null,
  );

  const uncertain = "Treatment A may reduce the risk of outcome B.";
  assert.equal(
    validateKnowledgeSimplification(uncertain, "Treatment A reduces outcome B."),
    null,
  );
});

test("material conditions, quantities, and acronyms must survive simplification", () => {
  const original =
    "This source reports the effect only in adults receiving treatment A during the first 12 weeks.";
  const faithful =
    "According to this source, the effect was seen only in adults receiving treatment A during the first 12 weeks.";
  assert.equal(validateKnowledgeSimplification(original, faithful), faithful);
  assert.equal(
    validateKnowledgeSimplification(original, "According to this source, the effect was seen in adults."),
    null,
  );
  assert.equal(
    validateKnowledgeSimplification(original, `${faithful} The effect was 25% larger.`),
    null,
  );
});

test("unchanged wording and explicit unsafe output fail closed", () => {
  assert.equal(validateKnowledgeSimplification(TECHNICAL_ORIGINAL, TECHNICAL_ORIGINAL), null);
  assert.equal(validateKnowledgeSimplification(TECHNICAL_ORIGINAL, "UNSAFE_TO_SIMPLIFY"), null);
});

test("ModelKnowledgeSimplifier accepts one guarded plain-text rewrite without structured output", async () => {
  const model = "fixture-plain-language";
  const governedFinding = finding();
  const request = buildKnowledgeSimplificationRequest(model, governedFinding);
  const provider = new DeterministicFixtureModelProvider([{
    id: "knowledge-plain-language",
    request,
    response: {
      id: "fixture-response",
      model,
      output: [{ type: "text", text: TECHNICAL_SIMPLIFIED }],
    },
  }]);
  const simplifier = new ModelKnowledgeSimplifier(new ModelRuntime(provider), model);

  assert.equal(
    await simplifier.simplify({ runId: "run-plain-language", finding: governedFinding }),
    TECHNICAL_SIMPLIFIED,
  );
});

test("plain-language follow-up changes presentation only and preserves canonical Knowledge authority", async () => {
  const provider = new SingleFindingProvider();
  const simplifier = new RecordingSimplifier();
  const config = resolveRuntimeConfig({
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-live",
  } as NodeJS.ProcessEnv);
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    knowledgeAcquisitionProvider: provider,
    knowledgeSimplifier: simplifier,
  });

  try {
    const conversationId = await createConversation(app);
    const objective = "Explain carbon fixation in C4 photosynthesis.";
    const initial = await ask(app, conversationId, "initial", objective);
    const intentVersionId = initial.accepted.intentVersionId;

    assert.equal(initial.body.outcome.findings[0]?.text, TECHNICAL_ORIGINAL);
    assert.doesNotMatch(initial.body.presentation.assistantMessage, /first capture carbon separately/u);

    const simpler = await ask(app, conversationId, "simpler", "Put that in plain language.");
    assert.equal(simpler.accepted.intentVersionId, intentVersionId);
    assert.equal(simpler.accepted.acceptedUnderstanding, objective);
    assert.equal(simpler.body.outcome.findings.length, 1);
    assert.equal(simpler.body.outcome.findings[0]?.claimId, "claim-c4");
    assert.equal(simpler.body.outcome.findings[0]?.text, TECHNICAL_ORIGINAL);
    assert.equal(simpler.body.outcome.findings[0]?.status, initial.body.outcome.findings[0]?.status);
    assert.equal(simpler.body.outcome.findings[0]?.confidence, initial.body.outcome.findings[0]?.confidence);
    assert.deepEqual(
      simpler.body.outcome.findings[0]?.contradictoryEvidenceIds,
      initial.body.outcome.findings[0]?.contradictoryEvidenceIds,
    );
    assert.equal(simpler.body.outcome.provenance[0]?.sourceId, "source-c4");
    assert.equal(simpler.body.outcome.provenance[0]?.canonicalUri, "https://knowledge.example/c4");
    assert.equal("decision" in simpler.body.outcome, false);
    assert.equal(
      simpler.body.outcome.uncertainties.some((item) => item.includes("does not perform genuine language simplification")),
      false,
    );

    assert.equal(simplifier.inputs.length, 1);
    assert.equal(simplifier.inputs[0]?.finding.text, TECHNICAL_ORIGINAL);
    assert.match(simpler.body.presentation.assistantMessage, /first capture carbon separately/u);
    assert.match(simpler.body.presentation.assistantMessage, /may reduce photorespiration/u);
    assert.match(simpler.body.presentation.assistantMessage, /hot and dry/u);
    assert.match(simpler.body.presentation.assistantMessage, /source report/u);
    assert.match(simpler.body.presentation.assistantMessage, /does not independently verify/u);
    assert.doesNotMatch(simpler.body.presentation.assistantMessage, /model|provider|workflow|schema/iu);

    const runResponse = await app.inject({
      method: "GET",
      url: `/api/v1/runs/${simpler.accepted.runId}`,
    });
    assert.equal(runResponse.statusCode, 200, runResponse.body);
    const run = runResponse.json<{ decision: unknown; events: Array<{ type: string }> }>();
    assert.equal(run.decision, null);
    assert.equal(run.events.some((event) => event.type === "DECIDING"), false);

    assert.deepEqual(provider.requests.map((request) => request.context), [
      [],
      ["Put that in plain language."],
    ]);
  } finally {
    await app.close();
  }
});
