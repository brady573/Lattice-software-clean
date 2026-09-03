import assert from "node:assert/strict";
import test from "node:test";
import type { DecisionOutcome, LatticeRun } from "../src/domain.js";
import type { DurableDecisionPlan } from "../src/intent/decision-plan-store.js";
import type { IntentProvenance, IntentVersion } from "../src/intent/types.js";
import type { KnowledgeOutcome, RunOutcome } from "../src/outcome.js";
import {
  composeSolandraPresentation,
  hydrateSolandraResource,
} from "../src/presentation/solandra-presentation.js";

const plan: DurableDecisionPlan = {
  decisionPlanId: "decision-plan:run-1",
  runId: "run-1",
  intentScopeId: "scope-1",
  intentVersionId: "intent-version-1",
  planningMaterial: {
    goal: "Choose a laptop for development work",
    hardConstraints: [
      { criterion: "price", operator: "lte", value: 1300 },
      { criterion: "batteryHours", operator: "gte", value: 12 },
    ],
    priorities: [{ criterion: "performance", weight: 1 }],
  },
  boundAt: "2026-08-30T14:00:00.000Z",
};

const intentProvenance: IntentProvenance = {
  kind: "EXPLICIT_USER",
  logicalUserTurnId: "turn-1",
  sourceMessageId: "message-1",
  sourceDigest: "a".repeat(64),
};

const intentVersion: IntentVersion = {
  intentScopeId: "scope-1",
  intentVersionId: "intent-version-1",
  version: 1,
  predecessorIntentVersionId: null,
  transitionId: "transition-1",
  lineageKind: "INITIAL",
  lineageTargetIntentVersionId: null,
  state: {
    objective: {
      value: { state: "VALUE", value: plan.planningMaterial.goal },
      provenance: intentProvenance,
    },
    requirements: {
      "budget::max": {
        value: { state: "VALUE", value: 1300 },
        provenance: intentProvenance,
      },
    },
    preferences: {
      capability: {
        value: { state: "VALUE", value: "MATTERS_MOST" },
        provenance: intentProvenance,
      },
    },
  },
  createdAt: "2026-08-30T14:00:00.000Z",
};

function run(status: LatticeRun["status"]): LatticeRun {
  return {
    id: "run-1",
    conversationId: "conversation-1",
    status,
    version: status === "COMPLETED" ? 8 : 3,
    request: structuredClone(plan.planningMaterial),
    decision: status === "COMPLETED"
      ? {
          goal: plan.planningMaterial.goal,
          winnerCandidateId: "candidate-a",
          evaluations: [],
          rationale: ["Candidate A satisfies the hard requirements and best serves the accepted priority."],
          evidenceIds: ["evidence-1"],
          truthAssessmentIds: ["truth-1"],
        }
      : null,
    explanation: status === "COMPLETED" ? "Candidate A is the supported recommendation." : null,
    truthAssessmentIds: status === "COMPLETED" ? ["truth-1"] : [],
    events: [],
  };
}

function knowledgeOutcome(): KnowledgeOutcome {
  return {
    kind: "KNOWLEDGE",
    objective: plan.planningMaterial.goal,
    acceptedUnderstanding: plan.planningMaterial.goal,
    findings: [{
      claimId: "claim-1",
      text: "The admitted evidence supports the material finding.",
      status: "SUPPORTED",
      confidence: "HIGH",
      evidenceIds: ["evidence-1"],
      contradictoryEvidenceIds: [],
      temporalQualifiers: { effectiveAt: null, period: null },
    }],
    uncertainties: [],
    provenance: [],
    truthAssessmentIds: ["truth-1"],
  };
}

function nonDecisionRun(resourceNeed: "NONE" | "CHECKLIST"): LatticeRun {
  return {
    id: `run-${resourceNeed.toLowerCase()}`,
    conversationId: "conversation-1",
    status: "COMPLETED",
    version: 6,
    request: {
      kind: "consultation",
      objective: plan.planningMaterial.goal,
      context: [],
      decisionNeed: "NONE",
      resourceNeed,
      sourceMessageId: "message-1",
      sourceMessageDigest: "a".repeat(64),
      intentVersion: 1,
      intentScopeId: intentVersion.intentScopeId,
      intentVersionId: intentVersion.intentVersionId,
    },
    decision: null,
    explanation: null,
    truthAssessmentIds: ["truth-1"],
    events: [],
  };
}

test("accepted understanding comes only from exact IntentVersion state, including requirements and preferences", () => {
  const listening = composeSolandraPresentation({ conversationId: "conversation-1" });
  assert.equal(listening.phase, "listening");
  assert.equal(listening.durableUnderstanding, undefined);
  assert.deepEqual(listening.supportingKnowledge, []);

  const planOnly = composeSolandraPresentation({
    conversationId: "conversation-1",
    run: run("PLANNING"),
    decisionPlan: plan,
  });
  assert.equal(planOnly.durableUnderstanding, undefined);
  assert.equal(planOnly.basis.intentVersionId, undefined);
  assert.deepEqual(planOnly.supportingKnowledge, []);

  const understanding = composeSolandraPresentation({
    conversationId: "conversation-1",
    run: run("PLANNING"),
    decisionPlan: plan,
    intentVersion,
  });
  assert.equal(understanding.phase, "understanding");
  assert.equal(understanding.durableUnderstanding?.goal, plan.planningMaterial.goal);
  assert.deepEqual(understanding.durableUnderstanding?.requirements, [{
    semanticKey: "budget::max",
    value: { state: "VALUE", value: 1300 },
    provenance: intentProvenance,
  }]);
  assert.deepEqual(understanding.durableUnderstanding?.preferences, [{
    semanticKey: "capability",
    value: { state: "VALUE", value: "MATTERS_MOST" },
    provenance: intentProvenance,
  }]);
  assert.equal(understanding.basis.intentVersionId, intentVersion.intentVersionId);
  assert.equal(understanding.nextAction, undefined);
  assert.equal(JSON.stringify(understanding).includes("Candidate A is the supported recommendation"), false);
});

test("supporting knowledge comes only from a faithful V36-backed completed outcome", () => {
  const completed = nonDecisionRun("NONE");
  const withoutOutcome = composeSolandraPresentation({
    conversationId: "conversation-1",
    run: completed,
    decisionPlan: plan,
    intentVersion,
  });
  assert.deepEqual(withoutOutcome.supportingKnowledge, []);

  const withOutcome = composeSolandraPresentation({
    conversationId: "conversation-1",
    run: completed,
    intentVersion,
    outcome: knowledgeOutcome(),
  });
  assert.deepEqual(withOutcome.supportingKnowledge, [{
    id: "knowledge:claim-1",
    label: "SUPPORTED",
    value: "The admitted evidence supports the material finding.",
    kind: "decision_basis",
    provenance: [{ authority: "v36", ref: "truth-1" }],
  }]);

  const mismatched = knowledgeOutcome();
  mismatched.truthAssessmentIds = ["truth-from-another-run"];
  assert.deepEqual(composeSolandraPresentation({
    conversationId: "conversation-1",
    run: completed,
    intentVersion,
    outcome: mismatched,
  }).supportingKnowledge, []);

  const incomplete = knowledgeOutcome();
  completed.truthAssessmentIds.push("truth-2");
  assert.deepEqual(composeSolandraPresentation({
    conversationId: "conversation-1",
    run: completed,
    intentVersion,
    outcome: incomplete,
  }).supportingKnowledge, []);
});

test("Knowledge and Action Preparation present without a DecisionPlan", () => {
  const knowledge = knowledgeOutcome();
  const knowledgeSnapshot = composeSolandraPresentation({
    conversationId: "conversation-1",
    run: nonDecisionRun("NONE"),
    intentVersion,
    outcome: knowledge,
  });
  assert.equal(knowledgeSnapshot.basis.decisionPlanId, undefined);
  assert.equal(knowledgeSnapshot.durableUnderstanding?.goal, knowledge.objective);
  assert.equal(knowledgeSnapshot.supportingKnowledge.length, 1);
  assert.equal(knowledgeSnapshot.nextAction, undefined);

  const actionOutcome: RunOutcome = {
    kind: "ACTION_PREPARATION",
    knowledge,
    resource: {
      kind: "CHECKLIST",
      title: "Prepared checklist",
      body: "Review the supported material before acting.",
      editable: true,
      executionAuthorized: false,
    },
  };
  const actionSnapshot = composeSolandraPresentation({
    conversationId: "conversation-1",
    run: nonDecisionRun("CHECKLIST"),
    intentVersion,
    outcome: actionOutcome,
  });
  assert.equal(actionSnapshot.basis.decisionPlanId, undefined);
  assert.equal(actionSnapshot.supportingKnowledge.length, 1);
  assert.equal(actionSnapshot.nextAction, undefined);
  assert.deepEqual(actionSnapshot.resources, []);
});

test("knowledge gaps remain uncertainty and cannot manufacture an actionable winner", () => {
  const snapshot = composeSolandraPresentation({
    conversationId: "conversation-1",
    run: run("AWAITING_CLARIFICATION"),
    decisionPlan: plan,
  });
  assert.equal(snapshot.phase, "knowledge_gap");
  assert.equal(snapshot.materialUncertainty.length, 1);
  assert.equal(snapshot.nextAction, undefined);
  assert.deepEqual(snapshot.resources, []);
});

test("only StructuredDecision supplies winner authority for actionable presentation", () => {
  const completed = run("COMPLETED");
  const snapshot = composeSolandraPresentation({
    conversationId: "conversation-1",
    run: completed,
    decisionPlan: plan,
  });

  assert.equal(snapshot.phase, "actionable");
  assert.equal(snapshot.nextAction?.winnerCandidateId, completed.decision?.winnerCandidateId);
  assert.deepEqual(snapshot.nextAction?.provenance[0], {
    authority: "structured_decision",
    ref: completed.id,
  });
  assert.equal(snapshot.resources.length, 2);
  assert.ok(snapshot.resources.every((resource) =>
    resource.capabilities.every((capability) => ["copy", "download", "play", "open_external", "show_location"].includes(capability)),
  ));
});

test("decision-rationale Resources hydrate frontier, tie, unresolved, and winner outcomes without fabricating a winner", () => {
  const cases: Array<{
    outcome: DecisionOutcome;
    winnerCandidateId?: string;
    frontierCandidateIds?: string[];
    tiedCandidateIds?: string[];
    materialUnknowns?: string[];
    expected: RegExp;
  }> = [
    { outcome: "FRONTIER", frontierCandidateIds: ["candidate-a", "candidate-b"], expected: /Frontier: candidate-a, candidate-b/u },
    { outcome: "TIE", tiedCandidateIds: ["candidate-a", "candidate-b"], expected: /Tied options: candidate-a, candidate-b/u },
    { outcome: "UNRESOLVED", materialUnknowns: ["criterion@1"], expected: /Material unknowns: criterion@1/u },
    { outcome: "RECOMMENDATION", winnerCandidateId: "candidate-a", expected: /Winner: candidate-a/u },
  ];

  for (const fixture of cases) {
    const completed = run("COMPLETED");
    const { winnerCandidateId: _priorWinner, ...decisionWithoutWinner } = completed.decision!;
    completed.decision = {
      ...decisionWithoutWinner,
      outcome: fixture.outcome,
      ...(fixture.winnerCandidateId ? { winnerCandidateId: fixture.winnerCandidateId } : {}),
      frontierCandidateIds: fixture.frontierCandidateIds ?? [],
      tiedCandidateIds: fixture.tiedCandidateIds ?? [],
      materialUnknowns: fixture.materialUnknowns ?? [],
    };
    const snapshot = composeSolandraPresentation({
      conversationId: "conversation-1",
      run: completed,
      decisionPlan: plan,
      intentVersion,
    });
    const descriptor = snapshot.resources.find((resource) => resource.id === `decision-rationale:${completed.id}`);
    assert.ok(descriptor, `Expected an advertised rationale Resource for ${fixture.outcome}.`);
    const hydrated = hydrateSolandraResource({
      snapshot,
      resourceId: descriptor.id,
      run: completed,
      decisionPlan: plan,
    });
    assert.equal(hydrated?.payload.kind, "generated_artifact");
    if (hydrated?.payload.kind !== "generated_artifact") continue;
    assert.match(hydrated.payload.text, new RegExp(`Outcome: ${fixture.outcome}`, "u"));
    assert.match(hydrated.payload.text, fixture.expected);
    if (fixture.winnerCandidateId === undefined) assert.doesNotMatch(hydrated.payload.text, /Winner:/u);
  }
});

test("presentation revisions are deterministic and transitions distinguish reconnect from update", () => {
  const first = composeSolandraPresentation({
    conversationId: "conversation-1",
    run: run("PLANNING"),
    decisionPlan: plan,
  });
  const reconnected = composeSolandraPresentation({
    conversationId: "conversation-1",
    run: run("PLANNING"),
    decisionPlan: plan,
    knownRevision: first.presentationRevision,
  });
  assert.equal(reconnected.presentationRevision, first.presentationRevision);
  assert.equal(reconnected.transition, "reconnected");

  const updated = composeSolandraPresentation({
    conversationId: "conversation-1",
    run: run("COMPLETED"),
    decisionPlan: plan,
    knownRevision: first.presentationRevision,
  });
  assert.notEqual(updated.presentationRevision, first.presentationRevision);
  assert.equal(updated.transition, "updated");
});

test("resource hydration is application-owned and bound to descriptors from the current snapshot", () => {
  const completed = run("COMPLETED");
  const snapshot = composeSolandraPresentation({
    conversationId: "conversation-1",
    run: completed,
    decisionPlan: plan,
  });
  const criteria = snapshot.resources.find((resource) => resource.kind === "text");
  const rationale = snapshot.resources.find((resource) => resource.kind === "generated_artifact");
  assert.ok(criteria);
  assert.ok(rationale);

  const criteriaResource = hydrateSolandraResource({
    snapshot,
    resourceId: criteria.id,
    run: completed,
    decisionPlan: plan,
  });
  assert.equal(criteriaResource?.payload.kind, "text");
  if (criteriaResource?.payload.kind === "text") {
    assert.match(criteriaResource.payload.text, /Requirement — price/);
    assert.match(criteriaResource.payload.text, /Preference — performance/);
  }

  const rationaleResource = hydrateSolandraResource({
    snapshot,
    resourceId: rationale.id,
    run: completed,
    decisionPlan: plan,
  });
  assert.equal(rationaleResource?.payload.kind, "generated_artifact");
  if (rationaleResource?.payload.kind === "generated_artifact") {
    assert.match(rationaleResource.payload.text, /Winner: candidate-a/);
    assert.equal(rationaleResource.payload.filename, "solandra-decision-run-1.txt");
  }
  assert.equal(hydrateSolandraResource({ snapshot, resourceId: "model-script", run: completed, decisionPlan: plan }), undefined);
});
