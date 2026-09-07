import assert from "node:assert/strict";
import test from "node:test";
import { ALPHA_NPM_RUNTIME_DEPENDENCY_CRITERION_ID } from "../src/decision/alpha-decision-capability.js";
import { createAlphaDecisionRuntimeComposition } from "../src/decision/alpha-decision-composition.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";

async function waitForCompletedRun(app: Awaited<ReturnType<typeof createRuntimeApp>>, runId: string): Promise<void> {
  for (let attempt = 0; attempt < 800; attempt += 1) {
    const response = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}` });
    assert.equal(response.statusCode, 200, response.body);
    const status = response.json<{ status: string }>().status;
    if (status === "COMPLETED") return;
    if (status === "FAILED" || status === "CANCELLED") {
      throw new Error(`A3 live Run ${runId} unexpectedly reached ${status}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`A3 live Run ${runId} did not complete inside the bounded proof window.`);
}

function dependencyCount(text: string): number | null {
  const match = /declares\s+(\d+)\s+runtime\s+dependenc(?:y|ies)\s+in\s+npm\s+registry\s+metadata/iu.exec(text);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

test("A3 LIVE: ordinary Solandra decision reaches real npm evidence, V36, DecisionPlan, Decision Engine, and presentation", { timeout: 45_000 }, async () => {
  const config = resolveRuntimeConfig({
    PORT: "3000",
    HOST: "127.0.0.1",
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_AUTO_MIGRATE: "false",
    LATTICE_AUTHENTICATION_MODE: "development-fixture",
    LATTICE_DEVELOPMENT_SUBJECT_ID: "a3-live-decision-user",
    LATTICE_TRUTH_MODE: "v36-live",
  });
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    ...createAlphaDecisionRuntimeComposition(),
  });

  try {
    const created = await app.inject({ method: "POST", url: "/api/v1/conversations" });
    assert.equal(created.statusCode, 201, created.body);
    const conversationId = created.json<{ conversation: { id: string } }>().conversation.id;

    const message = "Help me choose between npm packages express and fastify. Fewer runtime dependencies are my top priority.";
    const proposed = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: "a3-live-decision-turn", message },
    });
    assert.equal(proposed.statusCode, 202, proposed.body);
    const pending = proposed.json<{
      status: string;
      proposalId?: string;
      intentVersionId: string;
      question: string;
    }>();
    assert.equal(pending.status, "NEEDS_CLARIFICATION");
    assert.ok(pending.proposalId, proposed.body);
    assert.match(pending.question, /fewer published runtime dependencies as your top priority/iu);

    const confirmed = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/clarifications/${pending.proposalId}/confirm`,
      payload: { turnId: "a3-live-confirmation-turn", message: "Yes, that's correct." },
    });
    assert.equal(confirmed.statusCode, 202, confirmed.body);
    const accepted = confirmed.json<{
      status: string;
      runId: string;
      intentVersionId: string;
      decisionNeed: string;
    }>();
    assert.equal(accepted.status, "RUN_ACCEPTED");
    assert.equal(accepted.decisionNeed, "QUALIFIED");
    assert.notEqual(accepted.intentVersionId, pending.intentVersionId);

    await waitForCompletedRun(app, accepted.runId);

    const planResponse = await app.inject({ method: "GET", url: `/api/v1/runs/${accepted.runId}/decision-plan` });
    assert.equal(planResponse.statusCode, 200, planResponse.body);
    const plan = planResponse.json<{
      decisionPlan: {
        intentVersionId: string;
        planningMaterial: {
          hardRequirements: unknown[];
          priorities: Array<{ criterionId: string; criterionVersion: number; tier: string }>;
        };
      };
    }>().decisionPlan;
    assert.equal(plan.intentVersionId, accepted.intentVersionId);
    assert.deepEqual(plan.planningMaterial.hardRequirements, []);
    assert.deepEqual(plan.planningMaterial.priorities, [{
      criterionId: ALPHA_NPM_RUNTIME_DEPENDENCY_CRITERION_ID,
      criterionVersion: 1,
      tier: "MATTERS_MOST",
    }]);

    const outcomeResponse = await app.inject({ method: "GET", url: `/api/v1/runs/${accepted.runId}/outcome` });
    assert.equal(outcomeResponse.statusCode, 200, outcomeResponse.body);
    const outcome = outcomeResponse.json<{
      outcome: {
        kind: string;
        selectionAuthorized: boolean;
        explanation: string | null;
        knowledge: {
          findings: Array<{ text: string; status: string; evidenceIds: string[] }>;
          evidence?: Array<{ evidenceId: string; verification: string; admitted: boolean }>;
          provenance: Array<{ canonicalUri: string; publisher: string | null }>;
          truthAssessmentIds: string[];
        };
        decision: {
          outcome: string;
          winnerCandidateId?: string;
          frontierCandidateIds?: string[];
          evidenceIds: string[];
          truthAssessmentIds: string[];
        };
      };
    }>().outcome;
    assert.equal(outcome.kind, "DECISION_SUPPORT");
    assert.equal(outcome.selectionAuthorized, false);
    assert.equal(outcome.knowledge.findings.length, 2, JSON.stringify(outcome.knowledge.findings));
    assert.ok(outcome.knowledge.findings.every((item) => item.status === "SUPPORTED"), JSON.stringify(outcome.knowledge.findings));
    assert.ok((outcome.knowledge.evidence ?? []).every((item) => item.admitted && item.verification === "VERIFIED"));
    assert.equal(outcome.knowledge.provenance.length, 2);
    assert.ok(outcome.knowledge.provenance.every((item) => item.canonicalUri.startsWith("https://registry.npmjs.org/")));
    assert.ok(outcome.knowledge.truthAssessmentIds.length >= 2);
    assert.ok(outcome.decision.truthAssessmentIds.length >= 2);
    assert.ok(outcome.decision.evidenceIds.length >= 1);

    const counts = new Map<string, number>();
    for (const finding of outcome.knowledge.findings) {
      const packageMatch = /^Package\s+([^@\s]+)@/iu.exec(finding.text);
      const count = dependencyCount(finding.text);
      assert.ok(packageMatch?.[1] && count !== null, finding.text);
      counts.set(packageMatch[1].toLocaleLowerCase("en-US"), count);
    }
    assert.ok(counts.has("express") && counts.has("fastify"), JSON.stringify([...counts]));
    const expressCount = counts.get("express")!;
    const fastifyCount = counts.get("fastify")!;
    if (expressCount !== fastifyCount) {
      const expectedWinner = expressCount < fastifyCount ? "express" : "fastify";
      assert.equal(outcome.decision.outcome, "RECOMMENDATION");
      assert.equal(outcome.decision.winnerCandidateId, expectedWinner);
      assert.match(outcome.explanation ?? "", new RegExp(`recommends ${expectedWinner}`, "iu"));
    } else {
      assert.equal(outcome.decision.outcome, "TIE");
      assert.equal(outcome.decision.winnerCandidateId, undefined);
      assert.match(outcome.explanation ?? "", /no meaningful difference/iu);
    }
    assert.doesNotMatch(outcome.explanation ?? "", /DecisionPlan|criterion catalog|V36 assessment|material dominance|weighted preference score/iu);

    const presentationResponse = await app.inject({
      method: "GET",
      url: `/api/v1/conversations/${conversationId}/presentation`,
    });
    assert.equal(presentationResponse.statusCode, 200, presentationResponse.body);
    const presentation = presentationResponse.json<{
      presentation: {
        phase: string;
        durableUnderstanding: {
          preferences: Array<{ semanticKey: string; provenance: { kind: string } }>;
        };
        nextAction: { outcome: string; winnerCandidateId?: string } | null;
      };
    }>().presentation;
    assert.equal(presentation.phase, "actionable");
    assert.equal(presentation.durableUnderstanding.preferences[0]?.semanticKey, ALPHA_NPM_RUNTIME_DEPENDENCY_CRITERION_ID);
    assert.equal(presentation.durableUnderstanding.preferences[0]?.provenance.kind, "USER_CONFIRMED");
    assert.equal(presentation.nextAction?.outcome, outcome.decision.outcome);
    assert.equal(presentation.nextAction?.winnerCandidateId, outcome.decision.winnerCandidateId);

    console.log("A3_LIVE_DECISION_PROOF", JSON.stringify({
      status: "PASS",
      authenticatedSubjectMode: "development-fixture",
      decisionNeed: accepted.decisionNeed,
      intentVersionBound: plan.intentVersionId === accepted.intentVersionId,
      criterion: `${ALPHA_NPM_RUNTIME_DEPENDENCY_CRITERION_ID}@1`,
      counts: Object.fromEntries(counts),
      decisionOutcome: outcome.decision.outcome,
      winnerCandidateId: outcome.decision.winnerCandidateId ?? null,
      selectionAuthorized: outcome.selectionAuthorized,
      evidenceCount: outcome.decision.evidenceIds.length,
      truthAssessmentCount: outcome.decision.truthAssessmentIds.length,
      sourceOrigins: outcome.knowledge.provenance.map((item) => new URL(item.canonicalUri).origin),
      solandraPhase: presentation.phase,
    }));
  } finally {
    await app.close();
  }
});
