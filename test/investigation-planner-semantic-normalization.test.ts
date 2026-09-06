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
  readonly kind = "semantic-normalization-test";
  readonly structuredOutputCapability = "json_schema" as const;

  constructor(private readonly payload: unknown) {}

  async generate(request: CanonicalModelRequest, context: ModelCallContext): Promise<ModelProviderResult> {
    if (context.signal.aborted) throw new Error("cancelled");
    return {
      response: {
        id: "semantic-normalization-response",
        model: request.model,
        output: [{ type: "text", text: JSON.stringify(this.payload) }],
      },
    };
  }
}

function plannerFor(
  input: KnowledgeInvestigationPlanningInput,
  payload: unknown,
): ModelGatewayKnowledgeInvestigationPlanner {
  return new ModelGatewayKnowledgeInvestigationPlanner(
    new ModelRuntime(new StaticProvider(payload)),
    {
      model: "fixture-model",
      plannerKind: "semantic-normalization-planner",
      now: () => new Date("2026-09-06T04:00:00.000Z"),
    },
  );
}

function baseProposal(
  input: KnowledgeInvestigationPlanningInput,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  return {
    briefId: "semantic-normalization-brief",
    runId: input.runId,
    intentVersionId: input.intentVersionId,
    objective: input.objective,
    issues: [],
    missingFacts: [],
    sourceRequirements: [],
    dependencies: [],
    plannerKind: "semantic-normalization-planner",
    ...overrides,
  };
}

test("canonical planner normalizes explicit private content ahead of incidental retrieval metadata", async () => {
  const input: KnowledgeInvestigationPlanningInput = {
    runId: "private-normalization-run",
    intentVersionId: "private-normalization-intent",
    objective:
      "I need to assess a private supplier agreement. I haven't provided the agreement terms or the supplier's contact email. What should I investigate?",
    context: [],
  };

  const payload = baseProposal(input, {
    issues: [{
      issueId: "issue-private-terms",
      question: "What are the exact private supplier agreement terms?",
      materiality: "MATERIAL",
      rationale: "The agreement terms determine what must be interpreted.",
    }],
    missingFacts: [{
      factId: "fact-contact-email",
      question: "What is the supplier's contact email?",
      acquisitionMode: "USER_ONLY",
      materiality: "MATERIAL",
      rationale: "The email can be used to locate the private agreement.",
    }],
    sourceRequirements: [{
      requirementId: "source-private-agreement",
      issueIds: ["issue-private-terms"],
      authorityNeed: "PRIMARY_OR_OFFICIAL",
      jurisdictionNeeded: false,
      currentnessNeeded: true,
      description: "Use the controlling private agreement text.",
    }],
    dependencies: [{
      dependencyId: "dependency-contact-email",
      blockedIssueId: "issue-private-terms",
      dependsOnIssueIds: [],
      dependsOnFactIds: ["fact-contact-email"],
      rationale: "The agreement cannot be located without the supplier contact email.",
    }],
  });

  const brief = await plannerFor(input, payload).plan(input);
  const directFact = brief.missingFacts.find((fact) =>
    /agreement terms/iu.test(fact.question)
  );
  const locatorFact = brief.missingFacts.find((fact) => fact.factId === "fact-contact-email");
  const dependency = brief.dependencies.find((item) => item.blockedIssueId === "issue-private-terms");

  assert.ok(directFact);
  assert.equal(directFact.acquisitionMode, "USER_ONLY");
  assert.equal(directFact.materiality, "MATERIAL");
  assert.ok(locatorFact);
  assert.equal(locatorFact.materiality, "CONTEXTUAL");
  assert.ok(dependency);
  assert.ok(dependency.dependsOnFactIds.includes(directFact.factId));
  assert.ok(!dependency.dependsOnFactIds.includes("fact-contact-email"));
  assert.match(brief.issues[0]?.question ?? "", /requirements or constraints/iu);
});

test("canonical planner supplies an UNKNOWN jurisdiction key before jurisdiction-bound public research", async () => {
  const input: KnowledgeInvestigationPlanningInput = {
    runId: "jurisdiction-normalization-run",
    intentVersionId: "jurisdiction-normalization-intent",
    objective: "I want to remove a wall and redo my kitchen. What should I investigate before starting?",
    context: [],
  };

  const payload = baseProposal(input, {
    issues: [
      {
        issueId: "issue-structure",
        question: "Is the wall load-bearing or structural?",
        materiality: "MATERIAL",
        rationale: "Structural status changes what work is safe.",
      },
      {
        issueId: "issue-permits",
        question: "What local permits and building codes apply to the wall removal?",
        materiality: "MATERIAL",
        rationale: "Local approval requirements may govern the work.",
      },
      {
        issueId: "issue-utilities",
        question: "Where do plumbing, electrical, and gas lines run through the wall?",
        materiality: "MATERIAL",
        rationale: "Utility locations affect the work plan.",
      },
    ],
    missingFacts: [
      {
        factId: "fact-wall-type",
        question: "Is the wall load-bearing, partition, or exterior?",
        acquisitionMode: "USER_ONLY",
        materiality: "MATERIAL",
        rationale: "The wall type is property-specific.",
      },
      {
        factId: "fact-public-rules",
        question: "What permit requirements and building codes apply?",
        acquisitionMode: "RESEARCHABLE",
        materiality: "MATERIAL",
        rationale: "Lattice can research current official public rules.",
      },
      {
        factId: "fact-utility-locations",
        question: "Where are plumbing, electrical, and gas lines located relative to the wall?",
        acquisitionMode: "RESEARCHABLE",
        materiality: "MATERIAL",
        rationale: "The utility locations are part of the investigation.",
      },
    ],
    sourceRequirements: [
      {
        requirementId: "source-permits",
        issueIds: ["issue-permits"],
        authorityNeed: "PRIMARY_OR_OFFICIAL",
        jurisdictionNeeded: true,
        currentnessNeeded: true,
        description: "Use current local building department permit and building-code material.",
      },
      {
        requirementId: "source-utilities",
        issueIds: ["issue-utilities"],
        authorityNeed: "HIGH_QUALITY_SECONDARY",
        jurisdictionNeeded: false,
        currentnessNeeded: true,
        description: "Use reliable residential utility-routing guidance.",
      },
    ],
    dependencies: [
      {
        dependencyId: "dependency-permits",
        blockedIssueId: "issue-permits",
        dependsOnIssueIds: ["issue-structure"],
        dependsOnFactIds: ["fact-wall-type"],
        rationale: "Permit applicability depends on whether the wall is structural.",
      },
      {
        dependencyId: "dependency-utilities",
        blockedIssueId: "issue-utilities",
        dependsOnIssueIds: ["issue-structure"],
        dependsOnFactIds: ["fact-utility-locations"],
        rationale: "Locating utilities may depend on the structural wall assessment.",
      },
    ],
  });

  const brief = await plannerFor(input, payload).plan(input);
  const jurisdictionFact = brief.missingFacts.find((fact) =>
    /jurisdiction or location/iu.test(fact.question)
  );
  const permitDependency = brief.dependencies.find((item) => item.blockedIssueId === "issue-permits");
  const utilityDependency = brief.dependencies.find((item) => item.blockedIssueId === "issue-utilities");

  assert.ok(jurisdictionFact);
  assert.equal(jurisdictionFact.acquisitionMode, "UNKNOWN");
  assert.equal(jurisdictionFact.materiality, "MATERIAL");
  assert.ok(permitDependency);
  assert.ok(permitDependency.dependsOnFactIds.includes("fact-wall-type"));
  assert.ok(permitDependency.dependsOnFactIds.includes(jurisdictionFact.factId));
  assert.ok(permitDependency.dependsOnIssueIds.includes("issue-structure"));
  assert.equal(utilityDependency, undefined);
});

test("canonical planner does not invent a missing jurisdiction key when location is supplied", async () => {
  const input: KnowledgeInvestigationPlanningInput = {
    runId: "known-jurisdiction-run",
    intentVersionId: "known-jurisdiction-intent",
    objective: "My property is located in Denver, Colorado. What permits apply to this remodel?",
    context: [],
  };

  const payload = baseProposal(input, {
    issues: [{
      issueId: "issue-permits",
      question: "What local permits and building codes apply to the remodel?",
      materiality: "MATERIAL",
      rationale: "Local approval requirements may govern the work.",
    }],
    missingFacts: [{
      factId: "fact-public-rules",
      question: "What current permit requirements apply?",
      acquisitionMode: "RESEARCHABLE",
      materiality: "MATERIAL",
      rationale: "Lattice can research current official public rules.",
    }],
    sourceRequirements: [{
      requirementId: "source-permits",
      issueIds: ["issue-permits"],
      authorityNeed: "PRIMARY_OR_OFFICIAL",
      jurisdictionNeeded: true,
      currentnessNeeded: true,
      description: "Use current local building department permit and code material.",
    }],
    dependencies: [],
  });

  const brief = await plannerFor(input, payload).plan(input);
  assert.equal(
    brief.missingFacts.some((fact) => /jurisdiction or location/iu.test(fact.question)),
    false,
  );
});

test("canonical planner preserves UNKNOWN when jurisdiction ownership is not established", async () => {
  const input: KnowledgeInvestigationPlanningInput = {
    runId: "unknown-jurisdiction-owner-run",
    intentVersionId: "unknown-jurisdiction-owner-intent",
    objective: "I plan to create a new doorway through an interior wall during a kitchen remodel. What should I investigate before starting?",
    context: [],
  };

  const payload = baseProposal(input, {
    issues: [{
      issueId: "issue-local-rules",
      question: "What local permits and building codes apply to the doorway project?",
      materiality: "MATERIAL",
      rationale: "Local approval requirements may govern the work.",
    }],
    missingFacts: [{
      factId: "fact-property-location",
      question: "What is the property location?",
      acquisitionMode: "USER_ONLY",
      materiality: "MATERIAL",
      rationale: "The property location determines the local jurisdiction.",
    }],
    sourceRequirements: [{
      requirementId: "source-local-rules",
      issueIds: ["issue-local-rules"],
      authorityNeed: "PRIMARY_OR_OFFICIAL",
      jurisdictionNeeded: true,
      currentnessNeeded: true,
      description: "Use current local permit and building-code material.",
    }],
    dependencies: [{
      dependencyId: "dependency-local-rules",
      blockedIssueId: "issue-local-rules",
      dependsOnIssueIds: [],
      dependsOnFactIds: ["fact-property-location"],
      rationale: "Local rules cannot be identified until the governing location is known.",
    }],
  });

  const brief = await plannerFor(input, payload).plan(input);
  const jurisdictionFact = brief.missingFacts.find((fact) => fact.factId === "fact-property-location");
  assert.ok(jurisdictionFact);
  assert.equal(jurisdictionFact.acquisitionMode, "UNKNOWN");
  assert.equal(jurisdictionFact.materiality, "MATERIAL");
});
