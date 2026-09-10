import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import type {
  KnowledgeAcquisitionProvider,
  KnowledgeAcquisitionRequest,
  KnowledgeAcquisitionResult,
  RetrievedKnowledgeSource,
} from "../src/knowledge/acquisition.js";
import {
  RelevantKnowledgeAcquisitionProvider,
  type KnowledgeInvestigator,
} from "../src/knowledge/investigation.js";
import type { EvidentiarySuitability, KnowledgeOutcome } from "../src/outcome.js";
import type { KnowledgeSimplifier } from "../src/presentation/solandra/knowledge-simplification.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import {
  KnowledgeAcquisitionTruthPipeline,
  type KnowledgeEvidenceAdmissionPolicy,
} from "../src/truth/knowledge-acquisition-pipeline.js";

const fixedTime = "2026-09-06T17:00:00.000Z";

function source(
  sourceId: string,
  title: string,
  content: string,
  suitability: EvidentiarySuitability = "GENERAL_REFERENCE",
): RetrievedKnowledgeSource {
  return {
    sourceId,
    canonicalUri: `https://knowledge.example/${sourceId}`,
    title,
    publisher: "Knowledge Example",
    retrievedAt: fixedTime,
    publishedAt: "2026-09-01T00:00:00.000Z",
    contentType: "text/plain",
    content,
    metadata: { evidentiarySuitability: suitability },
  };
}

function sourceReport(sourceValue: RetrievedKnowledgeSource, claimId: string) {
  return {
    claimId,
    text: sourceValue.content,
    claimType: "INTERPRETIVE" as const,
    evidence: [{ sourceId: sourceValue.sourceId, relation: "SUPPORTS" as const, excerpt: sourceValue.content }],
  };
}

class RecordingProvider implements KnowledgeAcquisitionProvider {
  readonly kind = "a1-recording-provider";
  readonly requests: KnowledgeAcquisitionRequest[] = [];

  constructor(
    private readonly resolve: (request: KnowledgeAcquisitionRequest) => KnowledgeAcquisitionResult,
  ) {}

  async acquire(request: KnowledgeAcquisitionRequest): Promise<KnowledgeAcquisitionResult> {
    this.requests.push(structuredClone(request));
    return structuredClone(this.resolve(request));
  }
}

const config = resolveRuntimeConfig({
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-live",
} as NodeJS.ProcessEnv);

async function createConversation(app: FastifyInstance): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/conversations" });
  assert.equal(response.statusCode, 201, response.body);
  return response.json<{ conversation: { id: string } }>().conversation.id;
}

async function waitForCompletedRun(app: FastifyInstance, runId: string): Promise<void> {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const response = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}` });
    assert.equal(response.statusCode, 200, response.body);
    const status = response.json<{ status: string }>().status;
    if (status === "COMPLETED") return;
    if (status === "FAILED" || status === "CANCELLED") throw new Error(`Run ${runId} reached ${status}.`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 5));
  }
  throw new Error(`Run ${runId} did not complete.`);
}

type AcceptedTurn = {
  status: "RUN_ACCEPTED";
  runId: string;
  acceptedUnderstanding: string;
  intentVersionId: string;
};

type ClarificationTurn = {
  status: "NEEDS_CLARIFICATION";
  acceptedUnderstanding: string;
  intentVersionId: string;
  question: string;
};

async function submitTurn(
  app: FastifyInstance,
  conversationId: string,
  turnId: string,
  message: string,
): Promise<AcceptedTurn | ClarificationTurn> {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/turns`,
    payload: { turnId, message },
  });
  assert.equal(response.statusCode, 202, response.body);
  return response.json<AcceptedTurn | ClarificationTurn>();
}

async function outcomeFor(app: FastifyInstance, accepted: AcceptedTurn): Promise<{
  outcome: KnowledgeOutcome;
  presentation: { assistantMessage: string };
}> {
  await waitForCompletedRun(app, accepted.runId);
  const response = await app.inject({ method: "GET", url: `/api/v1/runs/${accepted.runId}/outcome` });
  assert.equal(response.statusCode, 200, response.body);
  return response.json();
}

function requireAccepted(value: AcceptedTurn | ClarificationTurn): AcceptedTurn {
  assert.equal(value.status, "RUN_ACCEPTED");
  return value as AcceptedTurn;
}

function requireClarification(value: AcceptedTurn | ClarificationTurn): ClarificationTurn {
  assert.equal(value.status, "NEEDS_CLARIFICATION");
  return value as ClarificationTurn;
}

test("A1 cast-iron answer is direct, source-grounded, and follow-ups preserve the same objective", async () => {
  const castIron = source(
    "cast-iron",
    "Cast iron corrosion",
    "Cast iron rusts because iron reacts with oxygen and water, forming iron oxides.",
  );
  const provider = new RecordingProvider(() => ({
    sources: [castIron],
    claims: [sourceReport(castIron, "cast-iron-report")],
  }));
  const simplifier: KnowledgeSimplifier = {
    async simplify() {
      return "Cast iron rusts because iron reacts with oxygen and water.";
    },
  };
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    knowledgeAcquisitionProvider: provider,
    knowledgeSimplifier: simplifier,
  });

  try {
    const conversationId = await createConversation(app);
    const objective = "Why does cast iron rust?";
    const initialAccepted = requireAccepted(await submitTurn(app, conversationId, "cast-initial", objective));
    const initial = await outcomeFor(app, initialAccepted);

    assert.equal(initialAccepted.acceptedUnderstanding, objective);
    assert.equal(initial.outcome.objective, objective);
    assert.equal(initial.outcome.findings.length, 1);
    assert.equal(initial.outcome.findings[0]?.basis, "SOURCE_REPORT");
    assert.match(initial.presentation.assistantMessage, /^The retrieved source material reports: Cast iron rusts because/iu);
    assert.match(initial.presentation.assistantMessage, /Cast iron corrosion — Knowledge Example/u);
    assert.match(initial.presentation.assistantMessage, /does not by itself independently verify/u);
    assert.doesNotMatch(initial.presentation.assistantMessage, /V36|proof obligation|provider|worker|UNRESOLVED/iu);

    const whyAccepted = requireAccepted(await submitTurn(app, conversationId, "cast-why", "Why?"));
    const why = await outcomeFor(app, whyAccepted);
    assert.equal(whyAccepted.intentVersionId, initialAccepted.intentVersionId);
    assert.equal(whyAccepted.acceptedUnderstanding, objective);
    assert.match(why.presentation.assistantMessage, /Cast iron rusts because iron reacts with oxygen and water/iu);
    assert.doesNotMatch(why.presentation.assistantMessage, /model-synthesized|V36|proof obligation/iu);

    const simplerAccepted = requireAccepted(await submitTurn(app, conversationId, "cast-simpler", "Explain that more simply."));
    const simpler = await outcomeFor(app, simplerAccepted);
    assert.equal(simplerAccepted.intentVersionId, initialAccepted.intentVersionId);
    assert.equal(simplerAccepted.acceptedUnderstanding, objective);
    assert.match(simpler.presentation.assistantMessage, /Cast iron rusts because iron reacts with oxygen and water\./u);
    assert.match(simpler.presentation.assistantMessage, /source report/u);
    assert.equal(simpler.outcome.findings[0]?.text, castIron.content);

    const sourcesAccepted = requireAccepted(await submitTurn(app, conversationId, "cast-sources", "What are your sources?"));
    const sources = await outcomeFor(app, sourcesAccepted);
    assert.equal(sourcesAccepted.intentVersionId, initialAccepted.intentVersionId);
    assert.match(sources.presentation.assistantMessage, /^Sources I used:/u);
    assert.match(sources.presentation.assistantMessage, /Cast iron corrosion — Knowledge Example/u);
    assert.match(sources.presentation.assistantMessage, /https:\/\/knowledge\.example\/cast-iron/u);
  } finally {
    await app.close();
  }
});

test("A1 clarification preserves canonical wording, Intent lineage, and source suitability", async () => {
  const tic = source(
    "tic-tax",
    "Tenancy-in-common tax guidance",
    "Tenancy in common ownership can affect taxes depending on jurisdiction and the transaction involved.",
    "AUTHORITATIVE_DOMAIN",
  );
  const dso = source(
    "dso-cash-flow",
    "Days sales outstanding",
    "Days sales outstanding can affect cash flow because slower collection delays cash receipts.",
  );
  const provider = new RecordingProvider((request) => {
    if (request.objective.includes("TIC")) return { sources: [tic], claims: [sourceReport(tic, "tic-report")] };
    if (request.objective.includes("DSO")) return { sources: [dso], claims: [sourceReport(dso, "dso-report")] };
    return { sources: [], claims: [] };
  });
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    knowledgeAcquisitionProvider: provider,
  });

  try {
    const ticConversation = await createConversation(app);
    const ticObjective = "How can TIC affect my taxes?";
    const ticClarification = requireClarification(
      await submitTurn(app, ticConversation, "tic-initial", ticObjective),
    );
    assert.equal(ticClarification.acceptedUnderstanding, ticObjective);
    assert.equal(ticClarification.question, "What does “TIC” mean in this question?");
    assert.equal(provider.requests.length, 0);

    const ticAccepted = requireAccepted(
      await submitTurn(app, ticConversation, "tic-meaning", "tenancy in common"),
    );
    const ticResult = await outcomeFor(app, ticAccepted);
    assert.equal(ticAccepted.intentVersionId, ticClarification.intentVersionId);
    assert.equal(ticAccepted.acceptedUnderstanding, ticObjective);
    assert.equal(ticResult.outcome.objective, ticObjective);
    assert.equal(ticResult.outcome.provenance[0]?.evidentiarySuitability, "AUTHORITATIVE_DOMAIN");
    assert.match(ticResult.presentation.assistantMessage, /Tenancy in common ownership can affect taxes/iu);
    assert.doesNotMatch(ticResult.presentation.assistantMessage, /authoritative source before I can answer/iu);

    const dsoConversation = await createConversation(app);
    const dsoObjective = "How does DSO affect cash flow?";
    const dsoClarification = requireClarification(
      await submitTurn(app, dsoConversation, "dso-initial", dsoObjective),
    );
    assert.equal(dsoClarification.question, "What does “DSO” mean in this question?");
    const dsoAccepted = requireAccepted(
      await submitTurn(app, dsoConversation, "dso-meaning", "days sales outstanding"),
    );
    const dsoResult = await outcomeFor(app, dsoAccepted);
    assert.equal(dsoAccepted.intentVersionId, dsoClarification.intentVersionId);
    assert.equal(dsoAccepted.acceptedUnderstanding, dsoObjective);
    assert.match(dsoResult.presentation.assistantMessage, /Days sales outstanding can affect cash flow/iu);
  } finally {
    await app.close();
  }
});

test("A1 non-responsive acquired material is excluded before V36 and cannot become answer basis", async () => {
  const unrelated = source(
    "unrelated-autumn",
    "Autumn tourism",
    "Tourism increases because leaves change color in autumn.",
  );
  const provider = new RecordingProvider(() => ({
    sources: [unrelated],
    claims: [sourceReport(unrelated, "unrelated-autumn-report")],
  }));
  const investigator: KnowledgeInvestigator = {
    kind: "a1-non-responsive-selection",
    async plan() {
      return { retrievalQueries: ["provider-ready fixture query"] };
    },
    async selectResponsive() {
      return { selections: [] };
    },
  };
  const truthPipeline = new KnowledgeAcquisitionTruthPipeline(
    new RelevantKnowledgeAcquisitionProvider(provider, investigator),
  );
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    truthPipeline,
  });

  try {
    const conversationId = await createConversation(app);
    const accepted = requireAccepted(
      await submitTurn(app, conversationId, "non-responsive", "Why do leaves change color in autumn?"),
    );
    const result = await outcomeFor(app, accepted);
    assert.equal(provider.requests.length, 1);
    assert.deepEqual(result.outcome.findings, []);
    assert.deepEqual(result.outcome.provenance, []);
    assert.equal(result.presentation.assistantMessage, "I couldn't establish why this happens from the available evidence.");
    assert.doesNotMatch(result.presentation.assistantMessage, /V36|proof|finding|provider|worker/iu);
  } finally {
    await app.close();
  }
});

test("A1 high-stakes answer requires explicit domain-authoritative source suitability", async () => {
  const general = source(
    "home-sale-tax",
    "Home sale tax overview",
    "A home sale can affect taxes depending on gain, ownership circumstances, and applicable rules.",
    "GENERAL_REFERENCE",
  );
  const provider = new RecordingProvider(() => ({
    sources: [general],
    claims: [sourceReport(general, "home-sale-tax-report")],
  }));
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    knowledgeAcquisitionProvider: provider,
  });

  try {
    const conversationId = await createConversation(app);
    const accepted = requireAccepted(
      await submitTurn(app, conversationId, "tax-source", "How can a home sale affect my taxes?"),
    );
    const result = await outcomeFor(app, accepted);
    assert.equal(result.outcome.findings.length, 1);
    assert.equal(result.outcome.provenance[0]?.evidentiarySuitability, "GENERAL_REFERENCE");
    assert.match(
      result.presentation.assistantMessage,
      /^I found relevant background material, but I need an appropriate authoritative source/iu,
    );
    assert.match(result.presentation.assistantMessage, /Home sale tax overview — Knowledge Example/u);
    assert.doesNotMatch(result.presentation.assistantMessage, /^A home sale can affect taxes/iu);
  } finally {
    await app.close();
  }
});

test("A1 material conflict remains visible and does not become a single fluent answer", async () => {
  const supporting = source("thermal-support", "Thermal study A", "The material expands when heated.");
  const contradicting = source("thermal-contradict", "Thermal study B", "The material does not expand when heated.");
  const provider = new RecordingProvider(() => ({
    sources: [supporting, contradicting],
    claims: [{
      claimId: "thermal-claim",
      text: "The material expands when heated.",
      claimType: "INTERPRETIVE" as const,
      evidence: [
        { sourceId: supporting.sourceId, relation: "SUPPORTS" as const, excerpt: supporting.content },
        { sourceId: contradicting.sourceId, relation: "CONTRADICTS" as const, excerpt: contradicting.content },
      ],
    }],
  }));
  const admissionPolicy: KnowledgeEvidenceAdmissionPolicy = {
    disposition(input) {
      return {
        verification: "VERIFIED",
        admitted: input.sourceContent.includes(input.proposed.excerpt),
        rejectionReason: null,
        provenanceComponentKey: `fixture:${input.source.id}`,
        provenanceConfidence: "HIGH",
        authoritativePrimary: false,
        establishedProofKinds: ["INTERPRETATION_SEPARATION", "LITERAL_FACT"],
      };
    },
  };
  const truthPipeline = new KnowledgeAcquisitionTruthPipeline(provider, admissionPolicy);
  const app = await createRuntimeApp(config, { memoryDispatchDelayMs: 1, truthPipeline });

  try {
    const conversationId = await createConversation(app);
    const accepted = requireAccepted(
      await submitTurn(app, conversationId, "conflict", "Does this material expand when heated?"),
    );
    const result = await outcomeFor(app, accepted);
    assert.equal(result.outcome.findings[0]?.status, "CONFLICTED");
    assert.equal(result.outcome.findings[0]?.contradictoryEvidenceIds.length, 1);
    assert.match(result.presentation.assistantMessage, /^The available evidence conflicts on this point/iu);
    assert.match(result.presentation.assistantMessage, /Thermal study A/u);
    assert.match(result.presentation.assistantMessage, /Thermal study B/u);
    assert.doesNotMatch(result.presentation.assistantMessage, /^The material expands when heated\./u);
  } finally {
    await app.close();
  }
});

test("A1 no-evidence outcome stays concise and avoids internal proof-state language", async () => {
  const provider = new RecordingProvider(() => ({ sources: [], claims: [] }));
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    knowledgeAcquisitionProvider: provider,
  });

  try {
    const conversationId = await createConversation(app);
    const accepted = requireAccepted(
      await submitTurn(app, conversationId, "unresolved", "What causes auroras?"),
    );
    const result = await outcomeFor(app, accepted);
    assert.deepEqual(result.outcome.findings, []);
    assert.equal(result.presentation.assistantMessage, "I couldn't establish why this happens from the available evidence.");
    assert.doesNotMatch(result.presentation.assistantMessage, /UNRESOLVED|V36|proof|finding|provider|worker|run state/iu);
  } finally {
    await app.close();
  }
});
