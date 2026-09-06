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
  readonly structuredOutputCapability = "json_schema" as const;
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

test("planner prompt distinguishes minimum user prerequisites from Lattice research burden", async () => {
  const { planner, provider } = plannerFor(baseProposal());
  await planner.plan(input);
  const prompt = provider.requests[0]?.messages[0]?.content ?? "";

  assert.match(prompt, /Classify acquisition burden independently from materiality/iu);
  assert.match(prompt, /minimum fact required before a MATERIAL public issue/iu);
  assert.match(prompt, /mark that prerequisite USER_ONLY and MATERIAL/iu);
  assert.match(prompt, /use UNKNOWN rather than guessing/iu);
  assert.match(prompt, /publicly discoverable from the supplied context is RESEARCHABLE/iu);
  assert.match(prompt, /remains Lattice's research burden/iu);
  assert.match(prompt, /represent only that minimum prerequisite separately/iu);
  assert.match(prompt, /do not substitute downstream research questions, incidental source metadata, or contact details/iu);
});

test("planner prompt requires genuine one-way blocking dependencies", async () => {
  const { planner, provider } = plannerFor(baseProposal());
  await planner.plan(input);
  const prompt = provider.requests[0]?.messages[0]?.content ?? "";

  assert.match(prompt, /Dependencies express one-way blocking, not relevance/iu);
  assert.match(prompt, /Never encode mutual informational relevance as reciprocal dependencies/iu);
  assert.match(prompt, /single defensible blocking direction/iu);
  assert.match(prompt, /if neither blocks the other, omit the edge/iu);
  assert.match(prompt, /Keep dependencies minimal/iu);
  assert.match(prompt, /omit decorative, speculative, or redundant edges/iu);
  assert.match(prompt, /issue dependencies are acyclic and minimal/iu);
});

test("planner requests provider-neutral structured output for the proposal contract", async () => {
  const { planner, provider } = plannerFor(baseProposal());
  await planner.plan(input);
  const request = provider.requests[0];
  assert.equal(request?.structuredOutput?.type, "json_schema");
  assert.match(JSON.stringify(request?.structuredOutput?.schema), /"acquisitionMode"/u);
  assert.match(JSON.stringify(request?.structuredOutput?.schema), /"dependsOnIssueIds"/u);
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
