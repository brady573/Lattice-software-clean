import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRuntimeApp } from "../dist/src/runtime-app.js";
import { resolveRuntimeConfig } from "../dist/src/runtime-config.js";

const question = process.env.LATTICE_LIVE_PROOF_QUESTION?.trim() || "What causes ocean tides?";
const followUp = "Show me the sources.";
const config = resolveRuntimeConfig({
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-live",
});

async function request(app, options) {
  const response = await app.inject(options);
  assert.ok(response.statusCode >= 200 && response.statusCode < 300, response.body);
  return response.json();
}

async function waitForOutcome(app, runId) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const run = await request(app, { method: "GET", url: `/api/v1/runs/${runId}` });
    if (run.status === "FAILED" || run.status === "CANCELLED") {
      throw new Error(`Run ${runId} reached ${run.status}.`);
    }
    if (run.status === "COMPLETED") {
      const response = await request(app, { method: "GET", url: `/api/v1/runs/${runId}/outcome` });
      return response.outcome;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Run ${runId} did not complete within 45 seconds.`);
}

async function turn(app, conversationId, message) {
  const accepted = await request(app, {
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/turns`,
    payload: { turnId: randomUUID(), message },
  });
  assert.equal(accepted.status, "RUN_ACCEPTED");
  assert.equal(accepted.decisionNeed, "NONE");
  const outcome = await waitForOutcome(app, accepted.runId);
  assert.equal(outcome.kind, "KNOWLEDGE");
  const plan = await app.inject({
    method: "GET",
    url: `/api/v1/runs/${accepted.runId}/decision-plan`,
  });
  assert.equal(plan.statusCode, 404, plan.body);
  return { accepted, outcome };
}

function publicOutcome(outcome) {
  return {
    findings: outcome.findings.map((finding) => ({
      status: finding.status,
      basis: finding.basis,
      confidence: finding.confidence,
      text: finding.text,
    })),
    sources: outcome.provenance.map((source) => ({
      title: source.title,
      canonicalUri: source.canonicalUri,
      publisher: source.publisher,
      retrievedAt: source.retrievedAt,
    })),
    evidence: outcome.evidence.map((item) => ({
      relation: item.relation,
      verification: item.verification,
      admitted: item.admitted,
      excerpt: item.excerpt,
    })),
    uncertainties: outcome.uncertainties,
  };
}

const app = await createRuntimeApp(config, { memoryDispatchDelayMs: 1 });
try {
  const created = await request(app, { method: "POST", url: "/api/v1/conversations" });
  const conversationId = created.conversation.id;
  const initial = await turn(app, conversationId, question);

  assert.equal(initial.accepted.acceptedUnderstanding, question);
  assert.ok(initial.outcome.findings.some((finding) => finding.status === "UNRESOLVED"));
  assert.ok(initial.outcome.findings.every((finding) => finding.confidence === "LOW"));
  assert.ok(initial.outcome.provenance.length > 0);
  assert.ok(initial.outcome.evidence.some((item) => item.admitted));
  assert.ok(initial.outcome.uncertainties.some((item) => item.includes("source")));

  const follow = await turn(app, conversationId, followUp);
  assert.equal(follow.accepted.intentVersionId, initial.accepted.intentVersionId);
  assert.equal(follow.accepted.acceptedUnderstanding, question);
  assert.ok(
    follow.outcome.provenance.length > initial.outcome.provenance.length,
    "The source follow-up must broaden the actual retrieval rather than repeat the original answer.",
  );

  const presentation = await request(app, {
    method: "GET",
    url: `/api/v1/conversations/${conversationId}/presentation`,
  });
  assert.equal(presentation.presentation.durableUnderstanding.goal, question);
  assert.ok(presentation.presentation.supportingKnowledge.length > 0);

  process.stdout.write(`${JSON.stringify({
    truthMode: config.truthMode,
    question,
    followUp,
    intentVersionId: initial.accepted.intentVersionId,
    objectivePreserved: true,
    decisionPlanAbsent: true,
    initial: publicOutcome(initial.outcome),
    followUpResult: publicOutcome(follow.outcome),
    solandra: {
      acceptedUnderstanding: presentation.presentation.durableUnderstanding.goal,
      supportingKnowledgeCount: presentation.presentation.supportingKnowledge.length,
      composerSourceCount: follow.outcome.provenance.length,
    },
  }, null, 2)}\n`);
} finally {
  await app.close();
}
