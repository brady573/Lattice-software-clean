import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { AlphaDecisionKnowledgeAcquisitionProvider } from "../dist/src/knowledge/npm-decision-acquisition.js";
import { RelevantKnowledgeAcquisitionProvider } from "../dist/src/knowledge/investigation.js";
import { WikimediaKnowledgeAcquisitionProvider } from "../dist/src/knowledge/wikimedia-acquisition.js";
import { createRuntimeApp } from "../dist/src/runtime-app.js";
import { resolveRuntimeConfig } from "../dist/src/runtime-config.js";
import { createConfiguredSolandraCognition } from "../dist/src/solandra/cognition-composition.js";
import { createConfiguredSolandraKnowledgeInvestigator } from "../dist/src/solandra/knowledge-investigator.js";
import { KnowledgeAcquisitionTruthPipeline } from "../dist/src/truth/knowledge-acquisition-pipeline.js";
import { AlphaDecisionKnowledgeEvidenceAdmissionPolicy } from "../dist/src/truth/npm-decision-admission.js";

const expectedSha = process.env.EXPECTED_PRODUCT_SHA?.trim();
const expectedTree = process.env.EXPECTED_PRODUCT_TREE?.trim();
assert.ok(expectedSha && expectedTree, "Exact Product SHA/tree are required.");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
assert.equal(git("rev-parse", "HEAD"), expectedSha);
assert.equal(git("rev-parse", "HEAD^{tree}"), expectedTree);
assert.ok(process.env.GROQ_API_KEY?.trim(), "GROQ_API_KEY is unavailable.");

const config = resolveRuntimeConfig({
  ...process.env,
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-live",
  LATTICE_AUTHENTICATION_MODE: "development-fixture",
  LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "issue91-live-partial-validator",
  LATTICE_SOLANDRA_COGNITION_ROUTE: "groq-gpt-oss-120b",
});
const solandra = createConfiguredSolandraCognition(config);
assert.ok(solandra, "Configured Solandra cognition is required.");
const investigator = createConfiguredSolandraKnowledgeInvestigator(config);
assert.ok(investigator, "Configured Solandra Knowledge investigator is required.");

const http = [];
const rawAcquisitions = [];
const cognition = [];
const nativeFetch = fetch;
const rawProvider = new WikimediaKnowledgeAcquisitionProvider({
  fetchImpl: async (input, init) => {
    const url = new URL(String(input));
    const response = await nativeFetch(input, init);
    http.push({
      sequence: http.length + 1,
      kind: url.searchParams.get("generator") === "search" ? "SEARCH" : "DETAIL",
      query: url.searchParams.get("gsrsearch"),
      pageIds: url.searchParams.get("pageids"),
      status: response.status,
      ok: response.ok,
    });
    return response;
  },
});
const recordingRawProvider = {
  kind: rawProvider.kind,
  async acquire(input) {
    const result = await rawProvider.acquire(input);
    rawAcquisitions.push({
      objective: input.objective,
      retrievalQueries: [...(input.investigationQueries ?? [])],
      completion: result.completion ?? { status: "COMPLETE" },
      sourceCount: result.sources.length,
      claimCount: result.claims.length,
      sources: result.sources.slice(0, 6).map((source) => ({
        sourceId: source.sourceId,
        title: source.title,
        canonicalUri: source.canonicalUri,
        excerpt: source.content.slice(0, 500),
      })),
    });
    return result;
  },
};
const semanticProvider = new RelevantKnowledgeAcquisitionProvider(recordingRawProvider, investigator);
const acquisitionProvider = new AlphaDecisionKnowledgeAcquisitionProvider(semanticProvider);
const truthPipeline = new KnowledgeAcquisitionTruthPipeline(
  acquisitionProvider,
  new AlphaDecisionKnowledgeEvidenceAdmissionPolicy(),
);
const observedCognition = {
  async interpret(input) {
    const result = await solandra.cognition.interpret(input);
    cognition.push({
      mode: result.mode,
      actualProvider: result.invocationProvenance.actualProvider ?? null,
      actualModel: result.invocationProvenance.actualModel ?? null,
      routeProvenance: result.invocationProvenance.routeProvenance ?? null,
      ...(result.mode === "GOVERNED" ? {
        objectiveRelation: result.proposal.objectiveRelation,
        requestedHelp: result.proposal.requestedHelp,
        knowledgeNeeds: [...result.proposal.knowledgeNeeds],
        materialAmbiguity: result.proposal.materialAmbiguity,
      } : {}),
    });
    return result;
  },
};

const app = await createRuntimeApp(config, {
  truthPipeline,
  memoryDispatchDelayMs: 1,
  solandraCognition: observedCognition,
  solandraAdvisory: solandra.advisory,
  solandraActionPreparer: solandra.actionPreparer,
  solandraKnowledgePresenter: solandra.knowledgePresenter,
});

async function request(options) {
  const response = await app.inject(options);
  assert.ok(response.statusCode >= 200 && response.statusCode < 300, response.body);
  return response.json();
}
async function waitForRun(runId) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const run = await request({ method: "GET", url: `/api/v1/runs/${runId}` });
    if (run.status === "FAILED" || run.status === "CANCELLED") throw new Error(`Run ${runId} reached ${run.status}`);
    if (run.status === "COMPLETED") {
      const outcome = (await request({ method: "GET", url: `/api/v1/runs/${runId}/outcome` })).outcome;
      return { run, outcome };
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`Run ${runId} timed out`);
}

const evidence = {
  product: { sha: expectedSha, tree: expectedTree },
  question: "Please use trustworthy external sources to explain how ocean tides occur and summarize what the sources support.",
  cognition,
  http,
  rawAcquisitions,
  userResult: null,
};
const artifactDir = resolve(process.env.VALIDATION_ARTIFACT_DIR ?? "../artifacts/issue91-live-partial");
mkdirSync(artifactDir, { recursive: true });

try {
  const created = await request({ method: "POST", url: "/api/v1/conversations" });
  const conversationId = created.conversation.id;
  const submitted = await request({
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/turns`,
    payload: { turnId: randomUUID(), message: evidence.question },
  });
  evidence.userResult = {
    submitStatus: submitted.status,
    publicInterpretation: submitted.interpretation ?? null,
    runId: submitted.runId ?? null,
  };
  assert.equal(submitted.status, "RUN_ACCEPTED");
  assert.ok(submitted.runId);
  const completed = await waitForRun(submitted.runId);
  const finalOutcome = await request({ method: "GET", url: `/api/v1/runs/${submitted.runId}/outcome` });
  Object.assign(evidence.userResult, {
    runStatus: completed.run.status,
    assistantMessage: finalOutcome.assistantMessage ?? null,
    findings: completed.outcome.findings,
    provenance: completed.outcome.provenance,
    uncertainties: completed.outcome.uncertainties,
  });
  assert.equal(cognition[0]?.mode, "GOVERNED");
  assert.equal(cognition[0]?.requestedHelp, "KNOWLEDGE");
  assert.equal(rawAcquisitions.length, 1);
  assert.ok(http.length > 0);
  assert.ok(http.length <= 11, `canonical Wikimedia call count exceeded repaired bound: ${http.length}`);
  const acquisition = rawAcquisitions[0];
  if (acquisition.completion.status === "PARTIAL") {
    assert.ok(
      completed.outcome.uncertainties.some((item) => item.includes("External source retrieval was incomplete")),
      "partial acquisition must remain explicit in governed uncertainty",
    );
    if (acquisition.sourceCount > 0) {
      assert.ok(completed.outcome.provenance.length > 0, "surviving responsive sources should remain visible when selected and admitted");
    }
  }
  writeFileSync(resolve(artifactDir, "evidence.json"), JSON.stringify(evidence, null, 2));
  console.log(`ISSUE91_LIVE_PROOF=${JSON.stringify(evidence)}`);
} finally {
  writeFileSync(resolve(artifactDir, "evidence.json"), JSON.stringify(evidence, null, 2));
  await app.close();
}
