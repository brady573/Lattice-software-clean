import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import type {
  KnowledgeAcquisitionProvider,
  KnowledgeAcquisitionRequest,
  KnowledgeAcquisitionResult,
} from "../src/knowledge/acquisition.js";
import {
  DeterministicKnowledgeInvestigationQueryDeriver,
  ObjectiveKnowledgeRelevanceQualifier,
  RelevantKnowledgeAcquisitionProvider,
} from "../src/knowledge/investigation.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import { renderSolandraConversationPage } from "../src/ui/solandra-conversation-page.js";

const fixedTime = "2026-09-04T20:00:00.000Z";

function source(
  sourceId: string,
  title: string,
  content: string,
  canonicalUri = `https://knowledge.example/${sourceId}`,
) {
  return {
    sourceId,
    canonicalUri,
    title,
    publisher: "Knowledge Example",
    retrievedAt: fixedTime,
    publishedAt: "2026-09-01T00:00:00.000Z",
    contentType: "text/plain",
    content,
  };
}

function claim(sourceId: string, claimId: string, text: string) {
  return {
    claimId,
    text,
    claimType: "INTERPRETIVE" as const,
    evidence: [{ sourceId, relation: "SUPPORTS" as const, excerpt: text }],
  };
}

class RecordingProvider implements KnowledgeAcquisitionProvider {
  readonly kind = "recording-relevance-fixture";
  readonly requests: KnowledgeAcquisitionRequest[] = [];

  constructor(private readonly result: KnowledgeAcquisitionResult) {}

  async acquire(request: KnowledgeAcquisitionRequest): Promise<KnowledgeAcquisitionResult> {
    this.requests.push(structuredClone(request));
    return structuredClone(this.result);
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

async function ask(app: FastifyInstance, message: string) {
  const created = await app.inject({ method: "POST", url: "/api/v1/conversations" });
  assert.equal(created.statusCode, 201, created.body);
  const conversationId = created.json<{ conversation: { id: string } }>().conversation.id;
  const accepted = await app.inject({
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/turns`,
    payload: { turnId: "relevance-turn", message },
  });
  assert.equal(accepted.statusCode, 202, accepted.body);
  const body = accepted.json<{
    status: string;
    runId: string;
    acceptedUnderstanding: string;
    decisionNeed: string;
  }>();
  assert.equal(body.status, "RUN_ACCEPTED");
  await waitForCompletedRun(app, body.runId);
  const outcomeResponse = await app.inject({ method: "GET", url: `/api/v1/runs/${body.runId}/outcome` });
  assert.equal(outcomeResponse.statusCode, 200, outcomeResponse.body);
  const resultBody = outcomeResponse.json();
  return {
    conversationId,
    accepted: body,
    outcome: resultBody.outcome,
    presentation: resultBody.presentation,
    runId: body.runId,
  };
}

test("query derivation turns natural objectives into bounded operational search concepts without replacing intent", () => {
  const deriver = new DeterministicKnowledgeInvestigationQueryDeriver();

  const navigation = deriver.derive({
    objective: "How does a duck know what direction south is?",
    context: [],
  });
  assert.ok(navigation.length >= 1 && navigation.length <= 2);
  assert.ok(navigation.some((query) => /duck/iu.test(query)));
  assert.ok(navigation.some((query) => /navigation|orientation/iu.test(query)));

  const technical = deriver.derive({
    objective: "Why can database indexes make writes slower?",
    context: [],
  });
  assert.ok(technical.some((query) => /database/iu.test(query)));
  assert.ok(technical.some((query) => /mechanism|causes/iu.test(query)));

  const practical = deriver.derive({
    objective: "What should I understand before repainting old plaster?",
    context: [],
  });
  assert.ok(practical.some((query) => /repainting|plaster/iu.test(query)));
  assert.ok(practical.some((query) => /preparation|considerations/iu.test(query)));
});

test("relevance gate excludes faithful lexical noise without claiming truth authority", () => {
  const deriver = new DeterministicKnowledgeInvestigationQueryDeriver();
  const qualifier = new ObjectiveKnowledgeRelevanceQualifier();
  const objective = "How does a duck know what direction south is?";
  const queries = deriver.derive({ objective, context: [] });

  const irrelevantSource = source(
    "noise",
    "Song of the South",
    "Song of the South is a musical film with a production history and theatrical release.",
  );
  const irrelevantClaim = claim("noise", "noise-claim", irrelevantSource.content);
  const irrelevant = qualifier.disposition({
    objective,
    context: [],
    queries,
    source: irrelevantSource,
    claim: irrelevantClaim,
  });
  assert.equal(irrelevant.relevant, false);

  const relevantSource = source(
    "relevant",
    "Duck navigation and orientation",
    "Duck navigation and orientation can use environmental cues to determine direction during movement.",
  );
  const relevantClaim = claim("relevant", "relevant-claim", relevantSource.content);
  const relevant = qualifier.disposition({
    objective,
    context: [],
    queries,
    source: relevantSource,
    claim: relevantClaim,
  });
  assert.equal(relevant.relevant, true);
  assert.ok(relevant.matchedTerms.some((term) => /navigation|orientation|direction/iu.test(term)));
});

test("causal relevance distinguishes unrelated, topic-related, and locally relation-responsive material", () => {
  const deriver = new DeterministicKnowledgeInvestigationQueryDeriver();
  const qualifier = new ObjectiveKnowledgeRelevanceQualifier();
  const objective = "Why do leaves change color in autumn?";
  const queries = deriver.derive({ objective, context: [] });
  const fixtures = [
    source("unrelated", "PostgreSQL indexes", "PostgreSQL supports indexes for database queries."),
    source("topic-only", "Autumn leaf color", "Autumn leaf color is a phenomenon where leaves become red and yellow."),
    source("disambiguation", "Autumn Leaves", "Autumn Leaves may refer to:"),
    source(
      "unrelated-causality",
      "Leaf peeping",
      "Leaf peeping concerns fall foliage and changing leaf colors. Tourism can be affected by climate change and severe weather.",
    ),
    source(
      "responsive",
      "Autumn leaf pigments",
      "In autumn, shorter daylight and lower temperatures cause changes in leaf pigments; as chlorophyll breaks down, other pigments become visible.",
    ),
  ];

  const dispositions = fixtures.map((fixture) => qualifier.disposition({
    objective,
    context: [],
    queries,
    source: fixture,
    claim: claim(fixture.sourceId, `${fixture.sourceId}-claim`, fixture.content),
  }));

  assert.deepEqual(dispositions.map((item) => item.relevant), [false, false, false, false, true]);
  for (const rejected of dispositions.slice(1, 4)) {
    assert.match(rejected.rationale, /topic\/concept overlap is insufficient/iu);
    assert.match(rejected.rationale, /causal relation is not locally addressed/iu);
  }
  assert.match(dispositions[4]?.rationale ?? "", /locally links causal\/mechanistic relation evidence/iu);
});

test("provider wrapper admits only the locally causal leaf fixture before V36", async () => {
  const objective = "Why do leaves change color in autumn?";
  const fixtures = [
    source("unrelated", "PostgreSQL indexes", "PostgreSQL supports indexes for database queries."),
    source("topic-only", "Autumn leaf color", "Autumn leaf color is a phenomenon where leaves become red and yellow."),
    source("disambiguation", "Autumn Leaves", "Autumn Leaves may refer to:"),
    source(
      "unrelated-causality",
      "Leaf peeping",
      "Leaf peeping concerns fall foliage and changing leaf colors. Tourism can be affected by climate change and severe weather.",
    ),
    source(
      "responsive",
      "Autumn leaf pigments",
      "In autumn, shorter daylight and lower temperatures cause changes in leaf pigments; as chlorophyll breaks down, other pigments become visible.",
    ),
  ];
  const provider = new RecordingProvider({
    sources: fixtures,
    claims: fixtures.map((fixture) => claim(fixture.sourceId, `${fixture.sourceId}-claim`, fixture.content)),
  });
  const wrapped = new RelevantKnowledgeAcquisitionProvider(provider);
  const result = await wrapped.acquire({ runId: "run-leaf-relevance", objective, context: [] });

  assert.deepEqual(result.sources.map((item) => item.sourceId), ["responsive"]);
  assert.deepEqual(result.claims.map((item) => item.claimId), ["responsive-claim"]);
});

test("provider-neutral investigation wrapper passes derived queries and removes irrelevant sources before V36", async () => {
  const objective = "How does a duck know what direction south is?";
  const irrelevant = source(
    "noise",
    "The Dead South",
    "The Dead South is a musical group formed in Canada.",
  );
  const relevant = source(
    "direction",
    "Duck navigation and orientation",
    "Duck navigation and orientation can use multiple cues to determine direction during movement.",
  );
  const provider = new RecordingProvider({
    sources: [irrelevant, relevant],
    claims: [
      claim("noise", "noise-claim", irrelevant.content),
      claim("direction", "direction-claim", relevant.content),
    ],
  });
  const wrapped = new RelevantKnowledgeAcquisitionProvider(provider);
  const result = await wrapped.acquire({ runId: "run-relevance", objective, context: [] });

  assert.ok(provider.requests[0]?.investigationQueries?.some((query) => /navigation|orientation/iu.test(query)));
  assert.deepEqual(result.sources.map((item) => item.sourceId), ["direction"]);
  assert.deepEqual(result.claims.map((item) => item.claimId), ["direction-claim"]);
  assert.equal(result.sources[0]?.content, relevant.content);
});

test("configured live runtime rejects generic index material and sends only mechanism-responsive source reports to V36", async () => {
  const objective = "Why can database indexes make writes slower?";
  const generic = source(
    "index-generic",
    "Database indexes",
    "Database indexes are data structures used to speed database queries, and writes update stored data.",
  );
  const relevant = source(
    "index-report",
    "Index maintenance",
    "Database indexes require additional maintenance during writes, which can slow updates.",
  );
  const provider = new RecordingProvider({
    sources: [generic, relevant],
    claims: [
      claim("index-generic", "generic-index-claim", generic.content),
      claim("index-report", "index-claim", relevant.content),
    ],
  });
  const config = resolveRuntimeConfig({
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-live",
  } as NodeJS.ProcessEnv);
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    knowledgeAcquisitionProvider: provider,
  });

  try {
    const result = await ask(app, objective);
    assert.equal(result.accepted.acceptedUnderstanding, objective);
    assert.equal(result.accepted.decisionNeed, "NONE");
    assert.equal(result.outcome.kind, "KNOWLEDGE");
    assert.equal(result.outcome.findings.length, 1);
    assert.equal(result.outcome.findings[0]?.text, relevant.content);
    assert.equal(result.outcome.findings[0]?.status, "UNRESOLVED");
    assert.equal(result.outcome.findings[0]?.basis, "SOURCE_REPORT");
    assert.equal(result.outcome.findings[0]?.confidence, "LOW");
    assert.equal(result.outcome.evidence[0]?.admitted, true);
    assert.ok(result.outcome.uncertainties.some((item: string) => item.includes("unresolved V36 proof obligations")));
    assert.equal(result.outcome.findings.some((item: { text: string }) => item.text === generic.content), false);

    const plan = await app.inject({ method: "GET", url: `/api/v1/runs/${result.runId}/decision-plan` });
    assert.equal(plan.statusCode, 404, plan.body);
    const run = await app.inject({ method: "GET", url: `/api/v1/runs/${result.runId}` });
    assert.equal(run.json().events.some((event: { type: string }) => event.type === "DECIDING"), false);
  } finally {
    await app.close();
  }
});

test("causal topic-only results yield empty governed Knowledge and a concise Solandra no-answer response", async () => {
  const objective = "Why do leaves change color in autumn?";
  const topicOnly = source(
    "leaf-description",
    "Autumn leaf color",
    "Autumn leaf color is a phenomenon where leaves become red and yellow.",
  );
  const disambiguation = source("autumn-leaves", "Autumn Leaves", "Autumn Leaves may refer to:"),
    provider = new RecordingProvider({
      sources: [topicOnly, disambiguation],
      claims: [
        claim("leaf-description", "leaf-description-claim", topicOnly.content),
        claim("autumn-leaves", "autumn-leaves-claim", disambiguation.content),
      ],
    });
  const config = resolveRuntimeConfig({
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-live",
  } as NodeJS.ProcessEnv);
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    knowledgeAcquisitionProvider: provider,
  });

  try {
    const result = await ask(app, objective);
    assert.equal(result.outcome.kind, "KNOWLEDGE");
    assert.deepEqual(result.outcome.findings, []);
    assert.deepEqual(result.outcome.provenance, []);
    assert.deepEqual(result.outcome.evidence, []);
    assert.equal(result.presentation.assistantMessage, "I couldn't establish why this happens from the available evidence.");
    assert.doesNotMatch(result.presentation.assistantMessage, /UNRESOLVED|SOURCE REPORT|V36|confidence/iu);

    const plan = await app.inject({ method: "GET", url: `/api/v1/runs/${result.runId}/decision-plan` });
    assert.equal(plan.statusCode, 404, plan.body);
    const run = await app.inject({ method: "GET", url: `/api/v1/runs/${result.runId}` });
    assert.equal(run.json().events.some((event: { type: string }) => event.type === "DECIDING"), false);
  } finally {
    await app.close();
  }
});

test("no relevant results yield sparse honest Knowledge instead of lexical-noise provenance", async () => {
  const objective = "What should I understand before repainting old plaster?";
  const irrelevant = source(
    "noise",
    "Look What You Made Me Do",
    "A song release is discussed with chart history and recording credits.",
  );
  const provider = new RecordingProvider({
    sources: [irrelevant],
    claims: [claim("noise", "noise-claim", irrelevant.content)],
  });
  const config = resolveRuntimeConfig({
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-live",
  } as NodeJS.ProcessEnv);
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    knowledgeAcquisitionProvider: provider,
  });

  try {
    const result = await ask(app, objective);
    assert.equal(result.outcome.kind, "KNOWLEDGE");
    assert.deepEqual(result.outcome.findings, []);
    assert.deepEqual(result.outcome.provenance, []);
    assert.deepEqual(result.outcome.evidence, []);
    assert.deepEqual(result.outcome.uncertainties, [
      "No validated external findings are sufficiently relevant to this objective.",
    ]);
  } finally {
    await app.close();
  }
});

test("Solandra suppresses an evidence excerpt when it is identical to the visible finding", () => {
  const html = renderSolandraConversationPage();
  assert.match(html, /const normalizedText = \(value\)/u);
  assert.match(html, /normalizedText\(item\.excerpt\) === normalizedText\(finding\.text\)/u);
  assert.match(html, /evidenceExcerpt/u);
});
