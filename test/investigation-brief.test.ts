import assert from "node:assert/strict";
import test from "node:test";
import {
  ModelGatewayKnowledgeInvestigationPlanner,
  investigationBriefIsCurrent,
  selectMaterialInvestigationClarification,
  validateInvestigationBrief,
  type InvestigationBrief,
  type KnowledgeInvestigationPlanningInput,
} from "../src/knowledge/investigation-brief.js";
import type { ModelProvider } from "../src/model/provider.js";
import { ModelRuntime } from "../src/model/runtime.js";
import type {
  CanonicalModelRequest,
  ModelCallContext,
  ModelProviderResult,
} from "../src/model/types.js";

const createdAt = "2026-09-05T12:30:00.000Z";

function briefFixture(
  input: Pick<KnowledgeInvestigationPlanningInput, "runId" | "intentVersionId" | "objective">,
  overrides: Partial<InvestigationBrief> = {},
): InvestigationBrief {
  return {
    briefId: "brief-1",
    runId: input.runId,
    intentVersionId: input.intentVersionId,
    objective: input.objective,
    issues: [{
      issueId: "issue-1",
      question: "What rules or constraints materially govern the objective?",
      materiality: "MATERIAL",
      rationale: "The answer depends on applicability that must be investigated.",
    }],
    missingFacts: [{
      factId: "fact-1",
      question: "What location or operating context applies?",
      acquisitionMode: "USER_ONLY",
      materiality: "MATERIAL",
      rationale: "Applicability cannot be resolved without this user-controlled fact.",
    }],
    sourceRequirements: [{
      requirementId: "source-1",
      issueIds: ["issue-1"],
      authorityNeed: "PRIMARY_OR_OFFICIAL",
      jurisdictionNeeded: true,
      currentnessNeeded: true,
      description: "Use a current authoritative source for the applicable jurisdiction.",
    }],
    dependencies: [{
      dependencyId: "dependency-1",
      blockedIssueId: "issue-1",
      dependsOnIssueIds: [],
      dependsOnFactIds: ["fact-1"],
      rationale: "The material issue cannot be scoped until the fact is known.",
    }],
    plannerKind: "fixture-planner",
    createdAt,
    ...overrides,
  };
}

class StaticJsonModelProvider implements ModelProvider {
  readonly kind = "deterministic-investigation-planner-fixture";
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

test("InvestigationBrief validates exact Run, IntentVersion, and objective binding", () => {
  const input = { runId: "run-1", intentVersionId: "intent-1", objective: "Understand this situation." };
  assert.equal(validateInvestigationBrief(briefFixture(input), input).intentVersionId, "intent-1");
  assert.throws(() => validateInvestigationBrief(briefFixture(input, { runId: "run-other" }), input), /run binding mismatch/u);
  assert.throws(() => validateInvestigationBrief(briefFixture(input, { intentVersionId: "intent-other" }), input), /IntentVersion binding mismatch/u);
  assert.throws(() => validateInvestigationBrief(briefFixture(input, { objective: "Different objective." }), input), /objective binding mismatch/u);
});

test("InvestigationBrief rejects duplicate IDs, dangling dependencies, and authority-shaped extras", () => {
  const input = { runId: "run-2", intentVersionId: "intent-2", objective: "Investigate safely." };
  const duplicate = briefFixture(input, {
    issues: [
      ...briefFixture(input).issues,
      { ...briefFixture(input).issues[0]!, question: "Another issue." },
    ],
  });
  assert.throws(() => validateInvestigationBrief(duplicate, input), /unique IDs/u);

  const dangling = briefFixture(input, {
    dependencies: [{
      dependencyId: "dependency-1",
      blockedIssueId: "issue-missing",
      dependsOnIssueIds: [],
      dependsOnFactIds: ["fact-1"],
      rationale: "Invalid reference.",
    }],
  });
  assert.throws(() => validateInvestigationBrief(dangling, input), /Unknown blocked issue reference/u);

  const extra = { ...briefFixture(input), decisionPlan: { winner: "invented" } };
  assert.throws(() => validateInvestigationBrief(extra, input));
});

test("KB-03 fake planner material is accepted only as a non-authoritative brief", () => {
  const input = {
    runId: "run-kb03",
    intentVersionId: "intent-kb03",
    objective: "I want to start selling food I make at home. Can I do that and what do I actually have to do?",
  };
  const raw = briefFixture(input, {
    issues: [
      {
        issueId: "regime",
        question: "Which cottage-food or home-food rules apply to this activity?",
        materiality: "MATERIAL",
        rationale: "The permitted activity and obligations depend on the governing regime.",
      },
      {
        issueId: "local",
        question: "Do local zoning, health, or private-premises restrictions apply?",
        materiality: "MATERIAL",
        rationale: "State permission may not resolve local or private restrictions.",
      },
    ],
    missingFacts: [
      {
        factId: "location",
        question: "What state/province and city or county is the home in?",
        acquisitionMode: "USER_ONLY",
        materiality: "MATERIAL",
        rationale: "Jurisdiction controls which rules and agencies apply.",
      },
      {
        factId: "product",
        question: "What foods and processing methods are planned?",
        acquisitionMode: "USER_ONLY",
        materiality: "MATERIAL",
        rationale: "Product characteristics can change applicability.",
      },
      {
        factId: "current-rule",
        question: "What rules are currently in force?",
        acquisitionMode: "RESEARCHABLE",
        materiality: "MATERIAL",
        rationale: "Current rules must be researched rather than delegated to the user.",
      },
    ],
    sourceRequirements: [{
      requirementId: "official-current",
      issueIds: ["regime", "local"],
      authorityNeed: "PRIMARY_OR_OFFICIAL",
      jurisdictionNeeded: true,
      currentnessNeeded: true,
      description: "Use current official material for the applicable jurisdiction and authority.",
    }],
    dependencies: [
      {
        dependencyId: "regime-location",
        blockedIssueId: "regime",
        dependsOnIssueIds: [],
        dependsOnFactIds: ["location", "product"],
        rationale: "Applicability cannot be scoped until threshold user facts are known.",
      },
      {
        dependencyId: "local-location",
        blockedIssueId: "local",
        dependsOnIssueIds: ["regime"],
        dependsOnFactIds: ["location"],
        rationale: "Local analysis depends on jurisdiction and the broader regime.",
      },
    ],
  });

  const accepted = validateInvestigationBrief(raw, input);
  const clarification = selectMaterialInvestigationClarification(accepted);
  assert.equal(accepted.objective, input.objective);
  assert.equal(accepted.sourceRequirements[0]?.authorityNeed, "PRIMARY_OR_OFFICIAL");
  assert.equal(accepted.sourceRequirements[0]?.jurisdictionNeeded, true);
  assert.equal(accepted.sourceRequirements[0]?.currentnessNeeded, true);
  assert.equal(clarification?.factId, "location");
  assert.doesNotMatch(JSON.stringify(accepted), /decisionPlan|DECIDING|admitted|verdict|executionAuthorized/iu);
});

test("unrelated renovation and cybersecurity fixtures exercise the same generic contract", () => {
  const renovationInput = {
    runId: "run-renovation",
    intentVersionId: "intent-renovation",
    objective: "I want to remove this wall and remodel the kitchen. What do I need to know before I start?",
  };
  const renovation = briefFixture(renovationInput, {
    issues: [{
      issueId: "structure",
      question: "What structural and approval constraints govern the proposed work?",
      materiality: "MATERIAL",
      rationale: "The work may depend on facts not stated by the user.",
    }],
    missingFacts: [{
      factId: "property-location",
      question: "Where is the property located?",
      acquisitionMode: "USER_ONLY",
      materiality: "MATERIAL",
      rationale: "Applicable requirements can depend on jurisdiction.",
    }],
    sourceRequirements: [{
      requirementId: "renovation-authority",
      issueIds: ["structure"],
      authorityNeed: "PRIMARY_OR_OFFICIAL",
      jurisdictionNeeded: true,
      currentnessNeeded: true,
      description: "Use current authoritative requirements applicable to the property.",
    }],
    dependencies: [{
      dependencyId: "structure-location",
      blockedIssueId: "structure",
      dependsOnIssueIds: [],
      dependsOnFactIds: ["property-location"],
      rationale: "Applicable constraints cannot be scoped without location.",
    }],
  });

  const cyberInput = {
    runId: "run-cyber",
    intentVersionId: "intent-cyber",
    objective: "A customer says we need better cybersecurity before renewal. I don't know what we actually need.",
  };
  const cyber = briefFixture(cyberInput, {
    issues: [{
      issueId: "customer-obligation",
      question: "What obligation or assurance is the customer actually requiring?",
      materiality: "MATERIAL",
      rationale: "The requested outcome is underspecified.",
    }],
    missingFacts: [{
      factId: "customer-document",
      question: "What exact requirement or contract language did the customer provide?",
      acquisitionMode: "USER_ONLY",
      materiality: "MATERIAL",
      rationale: "The user's private customer communication cannot be reliably researched externally.",
    }],
    sourceRequirements: [{
      requirementId: "cyber-standard",
      issueIds: ["customer-obligation"],
      authorityNeed: "HIGH_QUALITY_SECONDARY",
      jurisdictionNeeded: false,
      currentnessNeeded: true,
      description: "Use current, high-quality material for any referenced assurance framework.",
    }],
    dependencies: [{
      dependencyId: "customer-language",
      blockedIssueId: "customer-obligation",
      dependsOnIssueIds: [],
      dependsOnFactIds: ["customer-document"],
      rationale: "The requested assurance cannot be identified without the customer's actual requirement.",
    }],
  });

  assert.equal(validateInvestigationBrief(renovation, renovationInput).issues[0]?.issueId, "structure");
  assert.equal(validateInvestigationBrief(cyber, cyberInput).issues[0]?.issueId, "customer-obligation");
});

test("stale IntentVersion invalidates an otherwise valid brief", () => {
  const input = { runId: "run-stale", intentVersionId: "intent-v1", objective: "Investigate this objective." };
  const brief = validateInvestigationBrief(briefFixture(input), input);
  assert.equal(investigationBriefIsCurrent(brief, input), true);
  assert.equal(investigationBriefIsCurrent(brief, { ...input, intentVersionId: "intent-v2" }), false);
});

test("clarification selector chooses at most one material USER_ONLY blocker and never researchable facts", () => {
  const input = { runId: "run-select", intentVersionId: "intent-select", objective: "Investigate a complex question." };
  const raw = briefFixture(input, {
    missingFacts: [
      {
        factId: "researchable",
        question: "What public facts can Lattice research?",
        acquisitionMode: "RESEARCHABLE",
        materiality: "MATERIAL",
        rationale: "This is Lattice investigation work.",
      },
      {
        factId: "contextual-user",
        question: "What optional background would the user add?",
        acquisitionMode: "USER_ONLY",
        materiality: "CONTEXTUAL",
        rationale: "Useful but not a blocker.",
      },
      {
        factId: "material-user",
        question: "What private user-controlled fact determines applicability?",
        acquisitionMode: "USER_ONLY",
        materiality: "MATERIAL",
        rationale: "The material issue cannot be scoped without it.",
      },
    ],
    dependencies: [{
      dependencyId: "material-blocker",
      blockedIssueId: "issue-1",
      dependsOnIssueIds: [],
      dependsOnFactIds: ["researchable", "contextual-user", "material-user"],
      rationale: "These facts relate to the material issue.",
    }],
  });
  const brief = validateInvestigationBrief(raw, input);
  assert.equal(selectMaterialInvestigationClarification(brief)?.factId, "material-user");

  const researchOnly = validateInvestigationBrief(briefFixture(input, {
    missingFacts: [{
      factId: "researchable",
      question: "What public fact is needed?",
      acquisitionMode: "RESEARCHABLE",
      materiality: "MATERIAL",
      rationale: "Lattice can research it.",
    }],
    dependencies: [{
      dependencyId: "research-blocker",
      blockedIssueId: "issue-1",
      dependsOnIssueIds: [],
      dependsOnFactIds: ["researchable"],
      rationale: "Research is needed.",
    }],
  }), input);
  assert.equal(selectMaterialInvestigationClarification(researchOnly), null);
});

test("planner contract cannot mutate Intent or create Decision semantics", () => {
  const input = Object.freeze({
    runId: "run-authority",
    intentVersionId: "intent-authority",
    objective: "Explain what I need to investigate.",
    context: Object.freeze(["non-authoritative context"]),
  });
  const before = structuredClone(input);
  const brief = validateInvestigationBrief(briefFixture(input), input);
  assert.deepEqual(input, before);
  assert.equal(brief.intentVersionId, input.intentVersionId);
  assert.doesNotMatch(JSON.stringify(brief), /decisionPlan|DECIDING|preference|hardRequirement|authorization|admitted|verdict/iu);
});

test("Model Gateway planner accepts valid deterministic provider output and fails closed on invalid schema", async () => {
  const input: KnowledgeInvestigationPlanningInput = {
    runId: "run-model",
    intentVersionId: "intent-model",
    objective: "What do I need to investigate before acting?",
    context: [],
  };
  const validPayload = briefFixture(input, { plannerKind: "planner-test" });
  const validProvider = new StaticJsonModelProvider(validPayload);
  const validPlanner = new ModelGatewayKnowledgeInvestigationPlanner(
    new ModelRuntime(validProvider),
    { model: "fixture-model", plannerKind: "planner-test" },
  );
  const brief = await validPlanner.plan(input);
  assert.equal(brief.briefId, "brief-1");
  assert.equal(validProvider.requests.length, 1);
  assert.match(validProvider.requests[0]?.messages[0]?.content ?? "", /do not answer the user's objective/iu);

  const invalidProvider = new StaticJsonModelProvider({ ...validPayload, truthVerdict: "TRUE" });
  const invalidPlanner = new ModelGatewayKnowledgeInvestigationPlanner(
    new ModelRuntime(invalidProvider),
    { model: "fixture-model", plannerKind: "planner-test" },
  );
  await assert.rejects(() => invalidPlanner.plan({ ...input, runId: "run-model-invalid" }));
});
