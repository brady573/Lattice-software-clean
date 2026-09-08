import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SUBJECT_SHA = "9b3b2ed130ffdfaab6b7015958ee6c2f459d5c71";
const SUBJECT_TREE = "998d6cdf9af8b3d838828affb55bd26a0dfb0c5c";
const PRIMARY_REQUEST = "I’m choosing between keeping a small hobby project's background jobs in the main process or splitting them into another service. My priority is lower maintenance unless the separate service has a clear recoverability advantage. Based only on what we can establish, which direction fits that preference better?";
const RESOURCE_REQUEST = "Draft a short note to myself summarizing the two established tradeoffs and reminding me to review what remains unknown before I choose. This is a draft only; do not send, apply, or execute anything.";
const HELD_OUT_PROBE = "I’m thinking about whether to add a feature flag before changing the navigation in my small hobby app. Help me decide what I should know before I choose.";
const ARTIFACT_DIR = resolve(process.env.A6_ARTIFACT_DIR ?? "artifacts/a6");
mkdirSync(ARTIFACT_DIR, { recursive: true });

const load = async (path) => await import(pathToFileURL(resolve(process.cwd(), path)).href);
const [
  { createRuntimeApp },
  { resolveRuntimeConfig },
  { createConfiguredSolandraCognition },
  { OfflineFixtureTruthPipeline },
  { requiredProofObligations },
] = await Promise.all([
  load("dist/src/runtime-app.js"),
  load("dist/src/runtime-config.js"),
  load("dist/src/solandra/cognition-composition.js"),
  load("dist/src/truth/execution-pipeline.js"),
  load("dist/src/truth/contracts.js"),
]);

const config = resolveRuntimeConfig({
  ...process.env,
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-offline",
  LATTICE_SOLANDRA_COGNITION_ROUTE: "groq-gpt-oss-120b",
});
const configured = createConfiguredSolandraCognition(config);
assert.ok(configured, "A6 requires the configured live Solandra route.");
assert.equal(configured.model, "openai/gpt-oss-120b");

const trace = { cognition: [], advisory: [], preparation: [] };
function safeProvenance(value) {
  return {
    executionClass: value.executionClass,
    routeMode: value.routeMode,
    requestedProvider: value.requestedProvider,
    requestedModel: value.requestedModel,
    actualProvider: value.actualProvider,
    actualModel: value.actualModel,
    upstreamRequestId: value.upstreamRequestId ?? null,
    routeProvenance: value.routeProvenance,
  };
}
function assertLiveGroq(value, label) {
  assert.equal(value.executionClass, "LIVE_DIRECT", `${label}: live route required.`);
  assert.equal(value.routeMode, "PINNED", `${label}: pinned route required.`);
  assert.equal(value.requestedProvider, "groq", `${label}: Groq requested provider required.`);
  assert.equal(value.actualProvider, "groq", `${label}: Groq actual provider required.`);
  assert.equal(value.requestedModel, "openai/gpt-oss-120b", `${label}: pinned requested model required.`);
  assert.equal(value.actualModel, "openai/gpt-oss-120b", `${label}: pinned actual model required.`);
  assert.equal(value.routeProvenance, "COMPLETE", `${label}: complete route provenance required.`);
}
const cognition = {
  async interpret(input) {
    const result = await configured.cognition.interpret(input);
    assertLiveGroq(result.invocationProvenance, "cognition");
    trace.cognition.push({ message: input.message, proposal: result.proposal, provenance: safeProvenance(result.invocationProvenance) });
    return result;
  },
};
const advisory = {
  async advise(input) {
    const result = await configured.advisory.advise(input);
    assertLiveGroq(result.invocationProvenance, "advisory");
    trace.advisory.push({ result: result.result, provenance: safeProvenance(result.invocationProvenance) });
    return result;
  },
};
const actionPreparer = {
  async prepare(input) {
    const result = await configured.actionPreparer.prepare(input);
    assertLiveGroq(result.generationProvenance, "preparation generation");
    if (result.groundingProvenance !== null) assertLiveGroq(result.groundingProvenance, "preparation grounding");
    trace.preparation.push({
      result: result.result,
      generationProvenance: safeProvenance(result.generationProvenance),
      groundingProvenance: result.groundingProvenance === null ? null : safeProvenance(result.groundingProvenance),
    });
    return result;
  },
};
const knowledgePresenter = { async present(input) { return configured.knowledgePresenter.present(input); } };

const passedChecks = Object.fromEntries(requiredProofObligations("FACTUAL").map((kind) => [kind, "PASSED"]));
const resolvedTruth = new OfflineFixtureTruthPipeline({
  evidence: [
    {
      id: "a6-resolved-evidence-one",
      value: "In the validation scenario, keeping background jobs in the main process uses one deployable process rather than two.",
      sourceId: "a6-resolved-source-one",
      sourceLabel: "A6 resolved validation source one",
      admitted: true,
    },
    {
      id: "a6-resolved-evidence-two",
      value: "In the validation scenario, a separate worker process can restart without terminating the API process, but it creates a second deployable process to configure and operate.",
      sourceId: "a6-resolved-source-two",
      sourceLabel: "A6 resolved validation source two",
      admitted: true,
    },
  ],
  truthClaims: [
    {
      id: "a6-resolved-claim-one",
      text: "In the validation scenario, keeping background jobs in the main process uses one deployable process rather than two.",
      claimType: "FACTUAL",
      evidenceIds: ["a6-resolved-evidence-one"],
      scope: "a6-alpha-validation",
      checks: passedChecks,
      materiallyMisleading: false,
    },
    {
      id: "a6-resolved-claim-two",
      text: "In the validation scenario, a separate worker process can restart without terminating the API process, but it creates a second deployable process to configure and operate.",
      claimType: "FACTUAL",
      evidenceIds: ["a6-resolved-evidence-two"],
      scope: "a6-alpha-validation",
      checks: passedChecks,
      materiallyMisleading: false,
    },
  ],
  truthEvidence: [
    {
      evidenceId: "a6-resolved-evidence-one",
      claimId: "a6-resolved-claim-one",
      provenanceComponentKey: "a6-resolved-source-one",
      provenanceConfidence: "HIGH",
      relation: "SUPPORTS",
      sourceAccepted: true,
      authoritativePrimary: true,
      verification: "VERIFIED",
    },
    {
      evidenceId: "a6-resolved-evidence-two",
      claimId: "a6-resolved-claim-two",
      provenanceComponentKey: "a6-resolved-source-two",
      provenanceConfidence: "HIGH",
      relation: "SUPPORTS",
      sourceAccepted: true,
      authoritativePrimary: true,
      verification: "VERIFIED",
    },
  ],
});

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
async function createConversation(app) {
  const response = await app.inject({ method: "POST", url: "/api/v1/conversations" });
  assert.equal(response.statusCode, 201, response.body);
  return response.json().conversation.id;
}
async function postTurn(app, conversationId, message) {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/conversations/${encodeURIComponent(conversationId)}/turns`,
    payload: { turnId: randomUUID(), message },
  });
  assert.ok(response.statusCode === 200 || response.statusCode === 202, response.body);
  return response.json();
}
async function waitRun(app, runId, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await app.inject({ method: "GET", url: `/api/v1/runs/${encodeURIComponent(runId)}` });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    if (body.status === "COMPLETED") return body;
    if (body.status === "FAILED" || body.status === "CANCELLED") throw new Error(`A6 Product Run reached ${body.status}: ${JSON.stringify(body)}`);
    await sleep(50);
  }
  throw new Error(`Timed out waiting for A6 Product Run ${runId}.`);
}
async function waitOutcome(app, runId, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await app.inject({ method: "GET", url: `/api/v1/runs/${encodeURIComponent(runId)}/outcome` });
    if (response.statusCode === 200) return response.json();
    if (response.statusCode !== 202) throw new Error(`Unexpected outcome response ${response.statusCode}: ${response.body}`);
    await sleep(50);
  }
  throw new Error(`Timed out waiting for A6 outcome ${runId}.`);
}

const evidence = {
  subject: { sha: SUBJECT_SHA, tree: SUBJECT_TREE },
  primaryRequest: PRIMARY_REQUEST,
  resourceRequest: RESOURCE_REQUEST,
  heldOutProbe: HELD_OUT_PROBE,
  mainJourney: null,
  heldOut: null,
  routeTrace: trace,
  recordedPriorFailure: {
    workflowRun: 34265136277,
    classification: 5,
    boundary: "Live advisory omitted governed source-report uncertainty and Lattice failed closed with SOLANDRA_ADVISORY_FAILED.",
  },
  reusedRecoveryEvidence: {
    actualBrowserRun: 34255262596,
    browserLifecycleRun: 34255466112,
    browserLifecycleRetryJob: 102160662626,
    postgresRun: 34232620745,
  },
};

const app = await createRuntimeApp(config, {
  memoryDispatchDelayMs: 1,
  truthPipeline: resolvedTruth,
  solandraCognition: cognition,
  solandraAdvisory: advisory,
  solandraActionPreparer: actionPreparer,
  solandraKnowledgePresenter: knowledgePresenter,
});
try {
  const conversationId = await createConversation(app);
  const first = await postTurn(app, conversationId, PRIMARY_REQUEST);
  assert.equal(first.status, "RUN_ACCEPTED", JSON.stringify(first));
  assert.equal(first.acceptedUnderstanding, PRIMARY_REQUEST);
  assert.equal(first.interpretation?.authority, "NON_AUTHORITATIVE_PROPOSAL");
  assert.equal(first.interpretation?.requestedHelp, "DECISION");
  assert.equal(first.decisionNeed, "NONE");
  await waitRun(app, first.runId);
  const firstOutcome = await waitOutcome(app, first.runId);
  assert.equal(firstOutcome.outcome.kind, "KNOWLEDGE");
  assert.equal(firstOutcome.outcome.acceptedUnderstanding, PRIMARY_REQUEST);
  assert.equal(firstOutcome.outcome.findings.length, 2);
  assert.ok(firstOutcome.outcome.findings.every((item) => item.status === "SUPPORTED"));
  assert.equal(firstOutcome.outcome.uncertainties.length, 0);
  assert.equal(firstOutcome.outcome.provenance.length, 2);
  assert.ok(firstOutcome.outcome.truthAssessmentIds.length >= 2);
  const knowledgeId = firstOutcome.knowledgeReference?.knowledgeId;
  const recommendationId = firstOutcome.recommendationReference?.recommendationId;
  assert.ok(knowledgeId);
  assert.ok(recommendationId, JSON.stringify(firstOutcome));
  assert.equal(firstOutcome.recommendationReference.selectionAuthorized, false);
  assert.ok(trace.advisory.some((item) => item.result.status === "RECOMMENDATION"));

  const knowledgeResponse = await app.inject({ method: "GET", url: `/api/v1/knowledge/${encodeURIComponent(knowledgeId)}` });
  assert.equal(knowledgeResponse.statusCode, 200, knowledgeResponse.body);
  const knowledge = knowledgeResponse.json();
  assert.equal(knowledge.outcome.findings.length, 2);
  assert.equal(knowledge.outcome.provenance.length, 2);

  const recommendationResponse = await app.inject({ method: "GET", url: `/api/v1/recommendations/${encodeURIComponent(recommendationId)}` });
  assert.equal(recommendationResponse.statusCode, 200, recommendationResponse.body);
  const recommendation = recommendationResponse.json();
  assert.equal(recommendation.selectionAuthorized, false);
  assert.equal(recommendation.intentVersionId, first.intentVersionId);
  assert.ok(recommendation.knowledgeIds.includes(knowledgeId));
  assert.ok(recommendation.basis.length >= 1);
  assert.ok(recommendation.factualBasis.length >= 1);

  const second = await postTurn(app, conversationId, RESOURCE_REQUEST);
  assert.equal(second.status, "RUN_ACCEPTED", JSON.stringify(second));
  assert.equal(second.acceptedUnderstanding, RESOURCE_REQUEST);
  assert.equal(second.interpretation?.authority, "NON_AUTHORITATIVE_PROPOSAL");
  assert.equal(second.interpretation?.requestedHelp, "RESOURCE");
  await waitRun(app, second.runId);
  const secondOutcome = await waitOutcome(app, second.runId);
  assert.equal(secondOutcome.outcome.kind, "ACTION_PREPARATION");
  assert.equal(secondOutcome.outcome.resource.kind, "PREPARED_MESSAGE");
  assert.equal(secondOutcome.outcome.resource.editable, true);
  assert.equal(secondOutcome.outcome.resource.executionAuthorized, false);
  assert.ok(secondOutcome.outcome.resource.basis.length >= 1);
  assert.match(secondOutcome.preparationReference.resourceId, /^prepared_resource_/u);
  assert.equal(secondOutcome.preparationReference.executionAuthorized, false);
  assert.ok(secondOutcome.preparationReference.knowledgeIds.includes(knowledgeId));
  assert.ok(trace.preparation.some((item) => item.result.status === "PREPARED"));

  const presentationResponse = await app.inject({ method: "GET", url: `/api/v1/conversations/${encodeURIComponent(conversationId)}/presentation` });
  assert.equal(presentationResponse.statusCode, 200, presentationResponse.body);
  const presentation = presentationResponse.json().presentation;
  const descriptorId = `action-preparation:${second.runId}`;
  const descriptor = presentation.resources.find((item) => item.id === descriptorId && item.kind === "generated_artifact");
  assert.ok(descriptor, JSON.stringify(presentation.resources));
  assert.equal(descriptor.editable, true);
  assert.equal(descriptor.executionAuthorized, false);
  assert.notEqual(descriptor.id, secondOutcome.preparationReference.resourceId);
  const hydratedResponse = await app.inject({
    method: "GET",
    url: `/api/v1/conversations/${encodeURIComponent(conversationId)}/presentation/resources/${encodeURIComponent(descriptor.id)}?presentationRevision=${encodeURIComponent(presentation.presentationRevision)}`,
  });
  assert.equal(hydratedResponse.statusCode, 200, hydratedResponse.body);
  const hydrated = hydratedResponse.json().resource;
  assert.equal(hydrated.descriptor.id, descriptor.id);
  assert.equal(hydrated.descriptor.executionAuthorized, false);
  assert.equal(hydrated.payload.text, secondOutcome.outcome.resource.body);

  const advisoryCount = trace.advisory.length;
  const preparationCount = trace.preparation.length;
  const replayFirst = await waitOutcome(app, first.runId);
  const replaySecond = await waitOutcome(app, second.runId);
  assert.equal(replayFirst.recommendationReference.recommendationId, recommendationId);
  assert.equal(replaySecond.preparationReference.resourceId, secondOutcome.preparationReference.resourceId);
  assert.equal(trace.advisory.length, advisoryCount);
  assert.equal(trace.preparation.length, preparationCount);

  const continuityResponse = await app.inject({ method: "GET", url: `/api/v1/conversations/${encodeURIComponent(conversationId)}/continuity` });
  assert.equal(continuityResponse.statusCode, 200, continuityResponse.body);
  const continuity = continuityResponse.json();
  assert.equal(continuity.conversation.id, conversationId);
  assert.equal(continuity.messages.length, 2);
  assert.equal(continuity.runs.length, 2);
  assert.ok(continuity.knowledge.some((item) => item.knowledgeId === knowledgeId));
  assert.ok(continuity.recommendations.some((item) => item.recommendationId === recommendationId && item.selectionAuthorized === false));

  evidence.mainJourney = {
    conversationId,
    firstRunId: first.runId,
    acceptedUnderstanding: first.acceptedUnderstanding,
    cognition: first.interpretation,
    knowledgeId,
    findings: firstOutcome.outcome.findings,
    provenance: firstOutcome.outcome.provenance,
    uncertainties: firstOutcome.outcome.uncertainties,
    recommendationId,
    recommendation: recommendation.recommendation,
    recommendationSelectionAuthorized: recommendation.selectionAuthorized,
    recommendationBasis: recommendation.basis,
    resourceRunId: second.runId,
    preparedResourceId: secondOutcome.preparationReference.resourceId,
    presentationResourceId: descriptor.id,
    preparedBody: secondOutcome.outcome.resource.body,
    preparedBasis: secondOutcome.outcome.resource.basis,
    executionAuthorized: secondOutcome.outcome.resource.executionAuthorized,
    continuity: {
      messageCount: continuity.messages.length,
      runCount: continuity.runs.length,
      knowledgeCount: continuity.knowledge.length,
      recommendationCount: continuity.recommendations.length,
    },
  };
} finally {
  await app.close();
}

const probeApp = await createRuntimeApp(config, {
  memoryDispatchDelayMs: 1,
  truthPipeline: new OfflineFixtureTruthPipeline({ truthClaims: [], truthEvidence: [] }),
  solandraCognition: cognition,
  solandraAdvisory: advisory,
  solandraActionPreparer: actionPreparer,
  solandraKnowledgePresenter: knowledgePresenter,
});
try {
  const conversationId = await createConversation(probeApp);
  const probe = await postTurn(probeApp, conversationId, HELD_OUT_PROBE);
  assert.equal(probe.acceptedUnderstanding, HELD_OUT_PROBE);
  assert.equal(probe.interpretation?.authority, "NON_AUTHORITATIVE_PROPOSAL");
  if (probe.status === "NEEDS_CLARIFICATION") {
    assert.equal(probe.runId, undefined);
    assert.ok(typeof probe.question === "string" && probe.question.trim().length > 0);
    evidence.heldOut = { conversationId, status: probe.status, requestedHelp: probe.interpretation?.requestedHelp ?? null, question: probe.question, structuralFailureClassification: null };
  } else {
    assert.equal(probe.status, "RUN_ACCEPTED", JSON.stringify(probe));
    await waitRun(probeApp, probe.runId);
    const probeOutcome = await waitOutcome(probeApp, probe.runId);
    assert.equal(probeOutcome.outcome.kind, "KNOWLEDGE");
    assert.equal(probeOutcome.outcome.findings.length, 0, "Held-out probe must not manufacture Knowledge from model output.");
    assert.ok(probeOutcome.outcome.uncertainties.length >= 1);
    assert.equal(probeOutcome.recommendationReference, undefined, "No governed factual basis means no Recommendation may be established.");
    evidence.heldOut = {
      conversationId,
      runId: probe.runId,
      status: probe.status,
      requestedHelp: probe.interpretation?.requestedHelp ?? null,
      findings: probeOutcome.outcome.findings,
      uncertainties: probeOutcome.outcome.uncertainties,
      recommendationEstablished: false,
      structuralFailureClassification: null,
    };
  }
} finally {
  await probeApp.close();
}

assert.ok(trace.cognition.length >= 3);
assert.ok(trace.cognition.every((item) => item.provenance.actualProvider === "groq"));
assert.ok(trace.cognition.every((item) => item.provenance.routeProvenance === "COMPLETE"));
assert.ok(trace.advisory.some((item) => item.result.status === "RECOMMENDATION"));
assert.ok(trace.preparation.some((item) => item.result.status === "PREPARED"));

writeFileSync(resolve(ARTIFACT_DIR, "a6-product-proof-resolved.json"), JSON.stringify(evidence, null, 2));
console.log(`A6_SUBJECT_SHA=${SUBJECT_SHA}`);
console.log(`A6_SUBJECT_TREE=${SUBJECT_TREE}`);
console.log(`A6_MODEL=${configured.model}`);
console.log(`A6_LIVE_COGNITION_CALLS=${trace.cognition.length}`);
console.log(`A6_LIVE_ADVISORY_CALLS=${trace.advisory.length}`);
console.log(`A6_LIVE_PREPARATION_CALLS=${trace.preparation.length}`);
console.log(`A6_HELD_OUT_STATUS=${evidence.heldOut?.status ?? "UNKNOWN"}`);
console.log("A6_CONSEQUENTIAL_EXECUTION=false");
console.log("A6_ALPHA_PRODUCT_PROOF=PASS");
