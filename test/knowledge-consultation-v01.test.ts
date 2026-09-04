import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import type {
  KnowledgeAcquisitionProvider,
  KnowledgeAcquisitionRequest,
  KnowledgeAcquisitionResult,
} from "../src/knowledge/acquisition.js";
import { WikimediaKnowledgeAcquisitionProvider } from "../src/knowledge/wikimedia-acquisition.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import {
  KnowledgeAcquisitionTruthPipeline,
  type KnowledgeEvidenceAdmissionPolicy,
} from "../src/truth/knowledge-acquisition-pipeline.js";
import type { LatticeRunRequest } from "../src/domain.js";

const config = resolveRuntimeConfig({
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-offline",
} as NodeJS.ProcessEnv);

const fixedTime = "2026-09-04T03:00:00.000Z";

function acquired(
  request: KnowledgeAcquisitionRequest,
  options: { unsupported?: boolean; conflict?: boolean } = {},
): KnowledgeAcquisitionResult {
  const focus = request.context.at(-1) ?? "initial explanation";
  const claim = `${request.objective} — source material for ${focus}.`;
  const support = options.unsupported ? "Different retrieved text." : claim;
  const sources = [{
    sourceId: "source-a",
    canonicalUri: "https://knowledge.example/articles/a",
    title: "Source A",
    publisher: "Knowledge Example",
    retrievedAt: fixedTime,
    publishedAt: "2026-08-01T00:00:00.000Z",
    contentType: "text/plain",
    content: support,
  }];
  const evidence: KnowledgeAcquisitionResult["claims"][number]["evidence"] = [{
    sourceId: "source-a",
    relation: "SUPPORTS",
    excerpt: support,
  }];
  if (options.conflict) {
    sources.push({
      sourceId: "source-b",
      canonicalUri: "https://independent.example/articles/b",
      title: "Source B",
      publisher: "Independent Example",
      retrievedAt: fixedTime,
      publishedAt: "2026-08-02T00:00:00.000Z",
      contentType: "text/plain",
      content: "A materially conflicting report.",
    });
    (evidence as Array<{ sourceId: string; relation: "SUPPORTS" | "CONTRADICTS"; excerpt: string }>).push({
      sourceId: "source-b",
      relation: "CONTRADICTS",
      excerpt: "A materially conflicting report.",
    });
  }
  return {
    sources,
    claims: [{
      claimId: "claim-a",
      text: claim,
      claimType: "INTERPRETIVE",
      evidence,
      // Deliberately shaped as if a provider tried to claim authority. The
      // acquisition contract/pipeline must discard these extra fields.
      admitted: true,
      verdict: "TRUE",
      confidence: "HIGH",
    } as KnowledgeAcquisitionResult["claims"][number]],
  };
}

class RecordingProvider implements KnowledgeAcquisitionProvider {
  readonly kind = "deterministic-recording-source";
  readonly requests: KnowledgeAcquisitionRequest[] = [];

  constructor(
    private readonly response: (request: KnowledgeAcquisitionRequest) => KnowledgeAcquisitionResult = acquired,
  ) {}

  async acquire(request: KnowledgeAcquisitionRequest): Promise<KnowledgeAcquisitionResult> {
    this.requests.push(structuredClone(request));
    return this.response(request);
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
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/turns`,
    payload: { turnId, message },
  });
  assert.equal(response.statusCode, 202, response.body);
  const body = response.json<{
    status: string;
    runId: string;
    intentVersionId: string;
    acceptedUnderstanding: string;
    decisionNeed: string;
  }>();
  assert.equal(body.status, "RUN_ACCEPTED");
  await waitForCompletedRun(app, body.runId);
  const outcome = await app.inject({ method: "GET", url: `/api/v1/runs/${body.runId}/outcome` });
  assert.equal(outcome.statusCode, 200, outcome.body);
  return { accepted: body, outcome: outcome.json().outcome, runId: body.runId };
}

test("retrieved/provider output remains untrusted until V36 qualifies exact source-bound evidence", async () => {
  const provider = new RecordingProvider();
  const pipeline = new KnowledgeAcquisitionTruthPipeline(provider);
  const request: LatticeRunRequest = {
    kind: "consultation",
    objective: "Explain an unfamiliar mechanism.",
    context: [],
    decisionNeed: "NONE",
    resourceNeed: "NONE",
    sourceMessageId: "message-a",
    sourceMessageDigest: "a".repeat(64),
    intentVersion: 1,
    intentScopeId: "scope-a",
    intentVersionId: "intent-a",
  };
  const investigated = await pipeline.investigate("run-a", request);
  assert.equal(investigated.snapshot.bundle.claimEvidence[0]?.admitted, false);
  assert.equal(investigated.snapshot.bundle.claimEvidence[0]?.verification, "UNVERIFIED");
  assert.equal(investigated.snapshot.bundle.assessments[0]?.atomicDisposition, "INSUFFICIENT");
  assert.equal("verdict" in investigated.snapshot.bundle.claims[0]!, false);

  const validated = await pipeline.validate(investigated.snapshot);
  assert.equal(validated.bundle.claimEvidence[0]?.admitted, true);
  assert.equal(validated.bundle.claimEvidence[0]?.verification, "VERIFIED");
  assert.equal(validated.bundle.assessments[0]?.atomicDisposition, "SUPPORTED");

  const passedProofKinds = validated.bundle.checks
    .filter((check) => check.status === "PASSED")
    .map((check) => check.kind)
    .sort();
  assert.deepEqual(
    passedProofKinds,
    ["INTERPRETATION_SEPARATION", "LITERAL_FACT"],
  );
  assert.equal(
    validated.bundle.checks.find((check) => check.kind === "CONTRADICTION_SEARCH")?.status,
    "UNRESOLVED",
  );
  assert.equal(validated.bundle.assessments[0]?.verdict, "UNVERIFIED");
  assert.equal(validated.bundle.assessments[0]?.confidence, "LOW");
  assert.ok((validated.bundle.assessments[0]?.unresolvedObligationIds.length ?? 0) > 0);
});

test("Wikimedia adapter keeps follow-up language out of authority while changing retrieval strategy", async () => {
  const observed: URL[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    observed.push(new URL(String(input)));
    return new Response(JSON.stringify({
      query: {
        pages: [{
          pageid: 42,
          index: 1,
          title: "Retrieved topic",
          fullurl: "https://en.wikipedia.org/wiki/Retrieved_topic",
          touched: "2026-09-01T00:00:00.000Z",
          extract: "A direct source report answers the question. A second sentence supplies more detail.",
        }],
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const provider = new WikimediaKnowledgeAcquisitionProvider({ fetchImpl, resultLimit: 4 });
  const objective = "What explains the observed effect?";
  const initial = await provider.acquire({ runId: "run-wiki-1", objective, context: [] });
  const sources = await provider.acquire({
    runId: "run-wiki-2",
    objective,
    context: ["Show me the sources."],
  });

  assert.equal(initial.sources[0]?.canonicalUri, "https://en.wikipedia.org/wiki/Retrieved_topic");
  assert.equal(initial.claims[0]?.text, initial.claims[0]?.evidence[0]?.excerpt);
  assert.equal(sources.claims[0]?.text, initial.claims[0]?.text);
  assert.equal(observed[0]?.searchParams.get("gsrsearch"), objective);
  assert.equal(observed[1]?.searchParams.get("gsrsearch"), objective);
  assert.equal(observed[0]?.searchParams.get("gsrlimit"), "4");
  assert.equal(observed[1]?.searchParams.get("gsrlimit"), "6");
});

test("unsupported, conflicting, insufficient, and failed acquisition remain honest V36 outcomes", async () => {
  const request: LatticeRunRequest = {
    kind: "consultation",
    objective: "Understand a disputed factual question.",
    context: [],
    decisionNeed: "NONE",
    resourceNeed: "NONE",
    sourceMessageId: "message-boundaries",
    sourceMessageDigest: "b".repeat(64),
    intentVersion: 1,
    intentScopeId: "scope-boundaries",
    intentVersionId: "intent-boundaries",
  };

  const unsupported = new KnowledgeAcquisitionTruthPipeline(
    new RecordingProvider((input) => acquired(input, { unsupported: true })),
  );
  const unsupportedExecution = await unsupported.execute("run-unsupported", request);
  assert.equal(unsupportedExecution.bundle.assessments[0]?.atomicDisposition, "INSUFFICIENT");
  assert.equal(unsupportedExecution.bundle.claimEvidence[0]?.admitted, false);

  const qualifiedFixturePolicy: KnowledgeEvidenceAdmissionPolicy = {
    disposition({ source, proposed }) {
      return {
        verification: "VERIFIED",
        admitted: true,
        rejectionReason: null,
        provenanceComponentKey: `qualified:${new URL(source.canonicalUri).origin}`,
        provenanceConfidence: "HIGH",
        authoritativePrimary: proposed.relation === "SUPPORTS",
      };
    },
  };
  const conflicting = new KnowledgeAcquisitionTruthPipeline(
    new RecordingProvider((input) => acquired(input, { conflict: true })),
    qualifiedFixturePolicy,
  );
  const conflictExecution = await conflicting.execute("run-conflict", request);
  assert.equal(conflictExecution.bundle.assessments[0]?.atomicDisposition, "CONFLICT");
  assert.equal(conflictExecution.bundle.assessments[0]?.verdict, "MIXED");
  assert.equal(conflictExecution.bundle.assessments[0]?.contradictoryEvidenceIds.length, 1);

  const failed = new KnowledgeAcquisitionTruthPipeline({
    kind: "failing-source",
    async acquire() { throw new Error("transient provider detail must not leak"); },
  });
  const failureExecution = await failed.execute("run-failed", request);
  assert.equal(failureExecution.bundle.sources.length, 0);
  assert.equal(failureExecution.bundle.assessments[0]?.atomicDisposition, "INSUFFICIENT");
  assert.doesNotMatch(JSON.stringify(failureExecution.bundle), /transient provider detail/u);
});

test("three unrelated Knowledge consultations use the same canonical runtime without decision machinery", async () => {
  const provider = new RecordingProvider();
  const liveConfig = resolveRuntimeConfig({
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-live",
  } as NodeJS.ProcessEnv);
  const app = await createRuntimeApp(liveConfig, {
    memoryDispatchDelayMs: 1,
    knowledgeAcquisitionProvider: provider,
  });
  try {
    for (const [index, objective] of [
      "Why do some volcanic islands eventually disappear?",
      "What should I understand before repainting an old plaster wall?",
      "Why can database indexes make writes slower?",
    ].entries()) {
      const conversationId = await createConversation(app);
      const result = await ask(app, conversationId, `unrelated-${index}`, objective);
      assert.equal(result.accepted.acceptedUnderstanding, objective);
      assert.equal(result.accepted.decisionNeed, "NONE");
      assert.equal(result.outcome.kind, "KNOWLEDGE");
      assert.equal(result.outcome.findings[0]?.status, "UNRESOLVED");
      assert.equal(result.outcome.findings[0]?.confidence, "LOW");
      assert.ok(
        result.outcome.uncertainties.some((item: string) =>
          item.includes("unresolved V36 proof obligations")),
      );
      assert.equal(result.outcome.provenance[0]?.canonicalUri, "https://knowledge.example/articles/a");
      assert.equal(result.outcome.evidence[0]?.admitted, true);

      const plan = await app.inject({ method: "GET", url: `/api/v1/runs/${result.runId}/decision-plan` });
      assert.equal(plan.statusCode, 404, plan.body);
      const run = await app.inject({ method: "GET", url: `/api/v1/runs/${result.runId}` });
      assert.equal(run.json().events.some((event: { type: string }) => event.type === "DECIDING"), false);
    }
  } finally {
    await app.close();
  }
});

test("free-form follow-ups change current work without replacing authoritative intent", async () => {
  const provider = new RecordingProvider();
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    truthPipeline: new KnowledgeAcquisitionTruthPipeline(provider),
  });
  try {
    const conversationId = await createConversation(app);
    const objective = "Explain a mechanism I do not understand.";
    const initial = await ask(app, conversationId, "follow-initial", objective);
    const intentVersionId = initial.accepted.intentVersionId;
    const initialFinding = initial.outcome.findings[0]?.text;

    for (const [index, followUp] of [
      "Why?",
      "Show me the sources.",
      "What are you uncertain about?",
      "Explain the second point more simply.",
      "Is there evidence that disagrees?",
      "What about a related case?",
    ].entries()) {
      const result = await ask(app, conversationId, `follow-${index}`, followUp);
      assert.equal(result.accepted.intentVersionId, intentVersionId);
      assert.equal(result.accepted.acceptedUnderstanding, objective);
      assert.match(result.outcome.findings[0]?.text ?? "", new RegExp(followUp.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
      assert.notEqual(result.outcome.findings[0]?.text, initialFinding);
      assert.ok(result.outcome.provenance.length > 0);
      assert.ok(result.outcome.evidence.length > 0);
    }
    assert.deepEqual(provider.requests.at(-1)?.context, ["What about a related case?"]);

    const correction = await ask(
      app,
      conversationId,
      "follow-correction",
      "Actually, I meant explain a different mechanism.",
    );
    assert.notEqual(correction.accepted.intentVersionId, intentVersionId);
    assert.equal(correction.accepted.acceptedUnderstanding, "explain a different mechanism.");
    assert.equal(provider.requests.at(-1)?.objective, "explain a different mechanism.");
    assert.deepEqual(provider.requests.at(-1)?.context, []);
  } finally {
    await app.close();
  }
});

test("missing-referent clarification asks before investigation and correction establishes a successor", async () => {
  const provider = new RecordingProvider();
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    truthPipeline: new KnowledgeAcquisitionTruthPipeline(provider),
  });
  try {
    const conversationId = await createConversation(app);
    const ambiguous = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: "ambiguous", message: "Is this safe?" },
    });
    assert.equal(ambiguous.statusCode, 202, ambiguous.body);
    assert.equal(ambiguous.json().status, "NEEDS_CLARIFICATION");
    assert.equal(ambiguous.json().decisionNeed, "NONE");
    assert.equal(ambiguous.json().runId, undefined);
    assert.match(ambiguous.json().question, /referenced subject/u);
    assert.equal(provider.requests.length, 0);

    const corrected = await ask(
      app,
      conversationId,
      "ambiguous-correction",
      "Actually, I meant is the described material safe to handle?",
    );
    assert.notEqual(corrected.accepted.intentVersionId, ambiguous.json().intentVersionId);
    assert.equal(corrected.accepted.acceptedUnderstanding, "is the described material safe to handle?");
    assert.equal(provider.requests.length, 1);
  } finally {
    await app.close();
  }
});

test("Knowledge outcome and Solandra preserve source/evidence provenance without promoting intent fields into facts", async () => {
  const provider = new RecordingProvider();
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    truthPipeline: new KnowledgeAcquisitionTruthPipeline(provider),
  });
  try {
    const conversationId = await createConversation(app);
    const result = await ask(app, conversationId, "presentation", "Explain a sourced fact.");
    assert.equal(result.outcome.provenance[0]?.title, "Source A");
    assert.equal(result.outcome.evidence[0]?.sourceId, result.outcome.provenance[0]?.sourceId);
    assert.equal(result.outcome.findings[0]?.evidenceIds[0], result.outcome.evidence[0]?.evidenceId);

    const presentation = await app.inject({
      method: "GET",
      url: `/api/v1/conversations/${conversationId}/presentation`,
    });
    assert.equal(presentation.statusCode, 200, presentation.body);
    assert.equal(presentation.json().presentation.supportingKnowledge.length, 1);
    assert.equal(presentation.json().presentation.supportingKnowledge[0]?.label, "UNRESOLVED");
    assert.equal(presentation.json().presentation.basis.decisionPlanId, undefined);

    const html = (await app.inject({ method: "GET", url: "/" })).body;
    assert.match(html, /What remains uncertain/u);
    assert.match(html, /class="source-list"/u);
    assert.match(html, /Supporting evidence/u);
    assert.doesNotMatch(html, /provider dashboard|worker status/iu);
  } finally {
    await app.close();
  }
});

test("Knowledge acceptance examples remain disposable and absent from canonical runtime vocabulary", async () => {
  const sourceRoot = resolve(process.cwd(), "src");
  const paths: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith(".ts")) paths.push(path);
    }
  };
  await visit(sourceRoot);
  const canonical = (await Promise.all(paths.map((path) => readFile(path, "utf8")))).join("\n");
  assert.doesNotMatch(canonical, /volcanic islands eventually disappear/iu);
  assert.doesNotMatch(canonical, /repainting an old plaster wall/iu);
  assert.doesNotMatch(canonical, /database indexes make writes slower/iu);
});
