import assert from "node:assert/strict";
import test from "node:test";
import {
  ModelGatewayKnowledgeInvestigationPlanner,
  selectMaterialInvestigationClarification,
  type KnowledgeInvestigationPlanningInput,
} from "../src/knowledge/investigation-brief.js";
import type { ModelProvider } from "../src/model/provider.js";
import { ModelRuntime } from "../src/model/runtime.js";
import type {
  CanonicalModelRequest,
  ModelCallContext,
  ModelProviderResult,
} from "../src/model/types.js";

class StaticJsonModelProvider implements ModelProvider {
  readonly kind = "deterministic-investigation-contract-repair";
  readonly requests: CanonicalModelRequest[] = [];

  constructor(private readonly payload: unknown) {}

  async generate(request: CanonicalModelRequest, context: ModelCallContext): Promise<ModelProviderResult> {
    this.requests.push(structuredClone(request));
    if (context.signal.aborted) throw new Error("cancelled");
    return {
      response: {
        id: "fixture-response",
        model: request.model,
        output: [{ type: "text", text: JSON.stringify(this.payload) }],
      },
    };
  }
}

function proposalFixture(
  input: Pick<KnowledgeInvestigationPlanningInput, "runId" | "intentVersionId" | "objective">,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    briefId: "brief-1",
    runId: input.runId,
    intentVersionId: input.intentVersionId,
    objective: input.objective,
    issues: [{
      issueId: "issue-1",
      question: "Which governing constraints materially affect the objective?",
      materiality: "MATERIAL",
      rationale: "Applicability can change the investigation outcome.",
    }],
    missingFacts: [
      {
        factId: "fact-user",
        question: "What private user-controlled fact is needed to scope applicability?",
        acquisitionMode: "USER_ONLY",
        materiality: "MATERIAL",
        rationale: "This fact is not reliably obtainable through external research.",
      },
      {
        factId: "fact-research",
        question: "What current public rule or condition applies?",
        acquisitionMode: "RESEARCHABLE",
        materiality: "MATERIAL",
        rationale: "Lattice should investigate the public fact instead of burdening the user.",
      },
      {
        factId: "fact-context",
        question: "What optional background could improve orientation?",
        acquisitionMode: "UNKNOWN",
        materiality: "CONTEXTUAL",
        rationale: "Useful context should not be promoted to a blocker without evidence.",
      },
    ],
    sourceRequirements: [{
      requirementId: "source-1",
      issueIds: ["issue-1"],
      authorityNeed: "PRIMARY_OR_OFFICIAL",
      jurisdictionNeeded: true,
      currentnessNeeded: true,
      description: "Use current official authority for the applicable jurisdiction.",
    }],
    dependencies: [{
      dependencyId: "dependency-1",
      blockedIssueId: "issue-1",
      dependsOnIssueIds: [],
      dependsOnFactIds: ["fact-user", "fact-research"],
      rationale: "The issue cannot be resolved until both scope and researched applicability are known.",
    }],
    plannerKind: "planner-test",
    ...overrides,
  };
}

function plannerFor(
  payload: unknown,
  now: () => Date = () => new Date("2026-09-05T22:40:00.000Z"),
): { planner: ModelGatewayKnowledgeInvestigationPlanner; provider: StaticJsonModelProvider } {
  const provider = new StaticJsonModelProvider(payload);
  return {
    provider,
    planner: new ModelGatewayKnowledgeInvestigationPlanner(
      new ModelRuntime(provider),
      { model: "fixture-model", plannerKind: "planner-test", now },
    ),
  };
}

const input: KnowledgeInvestigationPlanningInput = {
  runId: "run-contract",
  intentVersionId: "intent-contract",
  objective: "What do I need to investigate before acting?",
  context: [],
};

test("planner request communicates the complete nested generic InvestigationBrief contract", async () => {
  const { planner, provider } = plannerFor(proposalFixture(input));
  await planner.plan(input);
  const prompt = provider.requests[0]?.messages[0]?.content ?? "";

  for (const requiredField of [
    "issueId",
    "question",
    "materiality",
    "rationale",
    "factId",
    "acquisitionMode",
    "requirementId",
    "issueIds",
    "authorityNeed",
    "jurisdictionNeeded",
    "currentnessNeeded",
    "description",
    "dependencyId",
    "blockedIssueId",
    "dependsOnIssueIds",
    "dependsOnFactIds",
  ]) {
    assert.match(prompt, new RegExp(`\\b${requiredField}\\b`, "u"));
  }

  assert.match(prompt, /arrays contain objects, not strings/iu);
  assert.match(prompt, /unique within their own collections/iu);
  assert.match(prompt, /reference an existing issueId/iu);
  assert.match(prompt, /Do not create dangling or self references/iu);
  assert.match(prompt, /Do not include createdAt/iu);
});

test("planner request communicates semantic materiality, acquisition, source, and dependency distinctions", async () => {
  const { planner, provider } = plannerFor(proposalFixture(input));
  await planner.plan(input);
  const prompt = provider.requests[0]?.messages[0]?.content ?? "";

  assert.match(prompt, /MATERIAL means .* materially change applicability, scope, or the investigation outcome/iu);
  assert.match(prompt, /CONTEXTUAL means useful background .* not .* necessary blocker/iu);
  assert.match(prompt, /USER_ONLY means Lattice cannot reliably obtain the fact through external research/iu);
  assert.match(prompt, /RESEARCHABLE means Lattice should investigate it rather than burden the user/iu);
  assert.match(prompt, /UNKNOWN means the acquisition burden cannot yet be classified responsibly/iu);
  assert.match(prompt, /PRIMARY_OR_OFFICIAL means governing, first-party, or official authority is needed/iu);
  assert.match(prompt, /HIGH_QUALITY_SECONDARY means reputable expert synthesis is appropriate/iu);
  assert.match(prompt, /GENERAL_ORIENTATION means broad orientation is sufficient/iu);
  assert.match(prompt, /jurisdictionNeeded true only when .* depends on jurisdiction or location/iu);
  assert.match(prompt, /currentnessNeeded true only when .* current or time-sensitive state/iu);
  assert.match(prompt, /blockedIssueId identifies the issue that cannot yet be resolved/iu);
});

test("valid deterministic model content is accepted and createdAt is Lattice-owned", async () => {
  const modelCreatedAt = "1900-01-01T00:00:00.000Z";
  const latticeCreatedAt = "2026-09-05T22:41:00.000Z";
  const { planner } = plannerFor(
    proposalFixture(input, { createdAt: modelCreatedAt }),
    () => new Date(latticeCreatedAt),
  );

  const brief = await planner.plan(input);
  assert.equal(brief.createdAt, latticeCreatedAt);
  assert.notEqual(brief.createdAt, modelCreatedAt);
  assert.equal(brief.runId, input.runId);
  assert.equal(brief.intentVersionId, input.intentVersionId);
  assert.equal(brief.objective, input.objective);
  assert.equal(brief.plannerKind, "planner-test");
});

test("malformed nested model structures remain rejected", async () => {
  const malformed = proposalFixture(input, {
    issues: ["not-an-issue-object"],
    missingFacts: ["not-a-fact-object"],
    sourceRequirements: { authorityNeed: "PRIMARY_OR_OFFICIAL" },
    dependencies: ["not-a-dependency-object"],
  });
  const { planner } = plannerFor(malformed);
  await assert.rejects(() => planner.plan(input));
});

test("dangling and self dependency references remain rejected", async () => {
  const dangling = proposalFixture(input, {
    dependencies: [{
      dependencyId: "dependency-dangling",
      blockedIssueId: "issue-missing",
      dependsOnIssueIds: [],
      dependsOnFactIds: ["fact-user"],
      rationale: "Invalid dangling reference.",
    }],
  });
  await assert.rejects(() => plannerFor(dangling).planner.plan(input), /Unknown blocked issue reference/u);

  const self = proposalFixture(input, {
    dependencies: [{
      dependencyId: "dependency-self",
      blockedIssueId: "issue-1",
      dependsOnIssueIds: ["issue-1"],
      dependsOnFactIds: [],
      rationale: "Invalid self reference.",
    }],
  });
  await assert.rejects(() => plannerFor(self).planner.plan(input), /cannot depend on its own blocked issue/u);
});

test("exact Run, IntentVersion, objective, and plannerKind bindings remain fail-closed", async () => {
  await assert.rejects(() => plannerFor(proposalFixture(input, { runId: "other-run" })).planner.plan(input), /run binding mismatch/u);
  await assert.rejects(() => plannerFor(proposalFixture(input, { intentVersionId: "other-intent" })).planner.plan(input), /IntentVersion binding mismatch/u);
  await assert.rejects(() => plannerFor(proposalFixture(input, { objective: "Different objective." })).planner.plan(input), /objective binding mismatch/u);
  await assert.rejects(() => plannerFor(proposalFixture(input, { plannerKind: "other-planner" })).planner.plan(input), /planner binding mismatch/u);
});

test("clarification and non-authority behavior remain unchanged", async () => {
  const { planner } = plannerFor(proposalFixture(input));
  const brief = await planner.plan(input);
  assert.equal(selectMaterialInvestigationClarification(brief)?.factId, "fact-user");
  assert.doesNotMatch(
    JSON.stringify(brief),
    /decisionPlan|DECIDING|truthVerdict|executionAuthorized|authorization|permission to act/iu,
  );

  const authorityExtra = proposalFixture(input, { truthVerdict: "TRUE" });
  await assert.rejects(() => plannerFor(authorityExtra).planner.plan(input));
});
