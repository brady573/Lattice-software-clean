import assert from "node:assert/strict";
import test from "node:test";
import {
  ModelGatewayKnowledgeInvestigationPlanner,
  type KnowledgeInvestigationPlanningInput,
} from "../src/knowledge/investigation-brief.js";
import type { ModelProvider } from "../src/model/provider.js";
import { ModelRuntime } from "../src/model/runtime.js";
import type {
  CanonicalModelRequest,
  ModelCallContext,
  ModelProviderResult,
} from "../src/model/types.js";

class StaticProvider implements ModelProvider {
  readonly kind = "semantic-repair-test";
  readonly requests: CanonicalModelRequest[] = [];

  constructor(private readonly payload: unknown) {}

  async generate(request: CanonicalModelRequest, context: ModelCallContext): Promise<ModelProviderResult> {
    this.requests.push(structuredClone(request));
    if (context.signal.aborted) throw new Error("cancelled");
    return {
      response: {
        id: "semantic-repair-response",
        model: request.model,
        output: [{ type: "text", text: JSON.stringify(this.payload) }],
      },
    };
  }
}

const input: KnowledgeInvestigationPlanningInput = {
  runId: "semantic-repair-run",
  intentVersionId: "semantic-repair-intent",
  objective: "What is the minimum investigation needed before I act?",
  context: [],
};

function baseProposal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    briefId: "semantic-repair-brief",
    runId: input.runId,
    intentVersionId: input.intentVersionId,
    objective: input.objective,
    issues: [
      {
        issueId: "issue-a",
        question: "What materially governs the objective?",
        materiality: "MATERIAL",
        rationale: "It can change the investigation outcome.",
      },
      {
        issueId: "issue-b",
        question: "What prerequisite must be resolved first?",
        materiality: "MATERIAL",
        rationale: "It controls whether the first issue can be investigated.",
      },
    ],
    missingFacts: [{
      factId: "fact-key",
      question: "What user-controlled prerequisite is required to make public research possible?",
      acquisitionMode: "USER_ONLY",
      materiality: "MATERIAL",
      rationale: "External research cannot proceed without this prerequisite.",
    }],
    sourceRequirements: [{
      requirementId: "source-a",
      issueIds: ["issue-a"],
      authorityNeed: "PRIMARY_OR_OFFICIAL",
      jurisdictionNeeded: false,
      currentnessNeeded: true,
      description: "Use current authoritative evidence for the material issue.",
    }],
    dependencies: [{
      dependencyId: "dep-a",
      blockedIssueId: "issue-a",
      dependsOnIssueIds: ["issue-b"],
      dependsOnFactIds: ["fact-key"],
      rationale: "The material issue depends on the prerequisite issue and fact.",
    }],
    plannerKind: "semantic-repair-planner",
    ...overrides,
  };
}

function plannerFor(payload: unknown): { planner: ModelGatewayKnowledgeInvestigationPlanner; provider: StaticProvider } {
  const provider = new StaticProvider(payload);
  return {
    provider,
    planner: new ModelGatewayKnowledgeInvestigationPlanner(new ModelRuntime(provider), {
      model: "fixture-model",
      plannerKind: "semantic-repair-planner",
      now: () => new Date("2026-09-06T02:00:00.000Z"),
    }),
  };
}

test("planner prompt requires minimum research keys, bounded scope, and self-consistent references", async () => {
  const { planner, provider } = plannerFor(baseProposal());
  await planner.plan(input);
  const prompt = provider.requests[0]?.messages[0]?.content ?? "";

  assert.match(prompt, /Before marking a fact RESEARCHABLE, verify that Lattice can actually pursue that research from the supplied context/iu);
  assert.match(prompt, /missing user-controlled or private prerequisite/iu);
  assert.match(prompt, /do not substitute incidental source or contact metadata/iu);
  assert.match(prompt, /smallest materially decision-relevant set/iu);
  assert.match(prompt, /overbroad, narrow the investigation instead of enumerating everything conceivable/iu);
  assert.match(prompt, /verify that every emitted reference resolves to an emitted ID/iu);
  assert.match(prompt, /issue dependencies are acyclic/iu);
});

test("cyclic issue dependencies are rejected fail-closed", async () => {
  const cyclic = baseProposal({
    dependencies: [
      {
        dependencyId: "dep-a",
        blockedIssueId: "issue-a",
        dependsOnIssueIds: ["issue-b"],
        dependsOnFactIds: [],
        rationale: "A depends on B.",
      },
      {
        dependencyId: "dep-b",
        blockedIssueId: "issue-b",
        dependsOnIssueIds: ["issue-a"],
        dependsOnFactIds: [],
        rationale: "B depends on A.",
      },
    ],
  });

  await assert.rejects(
    () => plannerFor(cyclic).planner.plan(input),
    /issue graph must be acyclic/iu,
  );
});
