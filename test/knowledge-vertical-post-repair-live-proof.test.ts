import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { FastifyInstance, InjectOptions } from "fastify";
import { WikimediaKnowledgeAcquisitionProvider } from "../src/knowledge/wikimedia-acquisition.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";

const EXPLANATORY_CASES = [
  {
    question: "Why do leaves change color in autumn?",
    passagePattern: /chlorophyll|shorter daylight|daylight hours shortening/iu,
    answerPattern: /chlorophyll|daylight|temperatures|pigment/iu,
  },
  {
    question: "How does a refrigerator keep food cold?",
    passagePattern: /heat pump|transfers heat|transfer heat/iu,
    answerPattern: /heat pump|transfers heat|transfer heat/iu,
  },
] as const;

const UNSUPPORTED_QUESTION =
  "Does drinking exactly 137 milliliters of water every morning guarantee that I will never get a headache?";

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
      return await request(app, { method: "GET", url: `/api/v1/runs/${runId}/outcome` });
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Run ${runId} did not complete within 45 seconds.`);
}

async function ask(app: FastifyInstance, question: string) {
  const created = await request(app, { method: "POST", url: "/api/v1/conversations" });
  const conversationId = created.conversation.id as string;
  const accepted = await request(app, {
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/turns`,
    payload: { turnId: randomUUID(), message: question },
  });
  assert.equal(accepted.status, "RUN_ACCEPTED");
  assert.equal(accepted.acceptedUnderstanding, question);
  assert.equal(accepted.decisionNeed, "NONE");
  const envelope = await waitForOutcome(app, accepted.runId as string);
  assert.equal(envelope.outcome.kind, "KNOWLEDGE");
  return { conversationId, accepted, envelope };
}

test("post-repair live Knowledge proof", { timeout: 240_000 }, async () => {
  const config = resolveRuntimeConfig({
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-live",
  });
  const rawProvider = new WikimediaKnowledgeAcquisitionProvider();
  const acquisitions: Array<{
    objective: string;
    queries: string[];
    sources: Array<{ title: string; canonicalUri: string; content: string }>;
    claims: Array<{ text: string }>;
  }> = [];
  const recordingProvider = {
    kind: `live-proof:${rawProvider.kind}`,
    async acquire(input: Parameters<typeof rawProvider.acquire>[0]) {
      const result = await rawProvider.acquire(input);
      acquisitions.push({
        objective: input.objective,
        queries: [...(input.investigationQueries ?? [])],
        sources: result.sources.map((source) => ({
          title: source.title,
          canonicalUri: source.canonicalUri,
          content: source.content,
        })),
        claims: result.claims.map((claim) => ({ text: claim.text })),
      });
      return result;
    },
  };

  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    knowledgeAcquisitionProvider: recordingProvider,
  });

  const report: any[] = [];
  try {
    for (const scenario of EXPLANATORY_CASES) {
      const acquisitionStart = acquisitions.length;
      const result = await ask(app, scenario.question);
      const acquired = acquisitions.slice(acquisitionStart);
      assert.ok(acquired.length > 0, `Expected acquisition for ${scenario.question}`);
      assert.ok(acquired.every((item) => item.objective === scenario.question),
        `Expected exact USER objective to remain authoritative for ${scenario.question}`);

      const rawSources = acquired.flatMap((item) => item.sources);
      const rawClaims = acquired.flatMap((item) => item.claims);
      const responsiveSource = rawSources.find((source) => scenario.passagePattern.test(source.content));
      assert.ok(responsiveSource,
        `Expected at least one live Wikimedia source with responsive explanatory content for ${scenario.question}`);
      assert.ok(rawClaims.some((claim) => scenario.passagePattern.test(claim.text)),
        `Expected acquisition to select responsive explanatory content for ${scenario.question}`);

      const outcome = result.envelope.outcome;
      const assistantMessage = result.envelope.presentation?.assistantMessage ?? "";
      assert.ok(outcome.findings.length > 0, `Expected governed Knowledge for ${scenario.question}`);
      assert.ok(outcome.evidence.length > 0, `Expected governed evidence for ${scenario.question}`);
      assert.ok(outcome.findings.some((finding: any) => scenario.passagePattern.test(finding.text ?? "")),
        `Expected responsive acquired content to survive relevance and V36 for ${scenario.question}`);
      assert.ok(outcome.provenance.some((source: any) => source.canonicalUri === responsiveSource.canonicalUri),
        `Expected governed provenance to identify the responsive source actually used for ${scenario.question}`);
      assert.doesNotMatch(assistantMessage, /couldn't establish|doesn't contain a direct explanation/iu);
      assert.match(assistantMessage, scenario.answerPattern);

      report.push({
        question: scenario.question,
        acceptedUnderstanding: result.accepted.acceptedUnderstanding,
        queries: acquired.flatMap((item) => item.queries),
        responsiveSource: {
          title: responsiveSource.title,
          canonicalUri: responsiveSource.canonicalUri,
        },
        rawSources: rawSources.map((source) => ({ title: source.title, canonicalUri: source.canonicalUri })),
        selectedClaims: rawClaims.slice(0, 4).map((claim) => claim.text.slice(0, 500)),
        findings: outcome.findings.map((finding: any) => ({
          status: finding.status,
          basis: finding.basis,
          text: finding.text.slice(0, 500),
        })),
        provenance: outcome.provenance.map((source: any) => ({ title: source.title, canonicalUri: source.canonicalUri })),
        assistantMessage,
      });
    }

    const unsupportedStart = acquisitions.length;
    const unsupported = await ask(app, UNSUPPORTED_QUESTION);
    const unsupportedOutcome = unsupported.envelope.outcome;
    const unsupportedMessage = unsupported.envelope.presentation?.assistantMessage ?? "";
    assert.deepEqual(unsupportedOutcome.findings, []);
    assert.deepEqual(unsupportedOutcome.evidence, []);
    assert.deepEqual(unsupportedOutcome.provenance, []);
    assert.match(unsupportedMessage, /couldn't establish|enough relevant evidence/iu);

    report.push({
      question: UNSUPPORTED_QUESTION,
      acceptedUnderstanding: unsupported.accepted.acceptedUnderstanding,
      queries: acquisitions.slice(unsupportedStart).flatMap((item) => item.queries),
      rawSources: acquisitions.slice(unsupportedStart).flatMap((item) => item.sources)
        .map((source) => ({ title: source.title, canonicalUri: source.canonicalUri })),
      findings: [],
      provenance: [],
      assistantMessage: unsupportedMessage,
    });

    console.log(`KNOWLEDGE_VERTICAL_POST_REPAIR_LIVE_PROOF=${JSON.stringify({
      candidateParent: "898469bfafefc4f49ee12995fe9bdedab97553d2",
      truthMode: config.truthMode,
      cases: report,
    })}`);
  } finally {
    await app.close();
  }
});
