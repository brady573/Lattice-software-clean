import assert from "node:assert/strict";
import test from "node:test";
import type { LatticeRun } from "../src/domain.js";
import { DeterministicFixtureModelProvider } from "../src/model/fixture-provider.js";
import { ModelRuntime } from "../src/model/runtime.js";
import type { KnowledgeFinding, KnowledgeOutcome } from "../src/outcome.js";
import {
  buildKnowledgeSimplificationRequest,
  ModelKnowledgeSimplifier,
  validateKnowledgeSimplification,
} from "../src/presentation/solandra/knowledge-simplification.js";
import { renderKnowledgeResponseForRun } from "../src/presentation/solandra/knowledge-response.js";

const FOLLOW_UP = "Put that in plain language.";
const SOURCE_REPORT_SUFFIX =
  "This status concerns what the retrieved source material reports; it does not independently verify the broader real-world claim.";

const PRESERVED_CASES = Object.freeze([
  Object.freeze({
    id: "A",
    canonical:
      "The semiconductor's depletion region widens under reverse bias because the applied potential increases the built-in electric field and drives majority carriers away from the junction.",
    raw:
      "When reverse bias is applied, the depletion region widens because the voltage increases the built‑in electric field and pushes majority carriers away from the junction.",
  }),
  Object.freeze({
    id: "B",
    canonical:
      "The available measurements do not establish that additive Q causes the observed failure; they suggest only a possible association.",
    raw:
      "The measurements we have don’t show that additive Q causes the failure; they only suggest a possible association.",
  }),
  Object.freeze({
    id: "C",
    canonical:
      "The reported efficiency gain applies only when the device operates below 40 °C under continuous load; performance under intermittent load was not evaluated.",
    raw:
      "The efficiency gain is only valid when the device runs continuously at temperatures below 40 °C; performance under intermittent load was not evaluated.",
  }),
]);

function syntheticFinding(caseId: string, text: string): KnowledgeFinding {
  return {
    claimId: `synthetic-preserved-live-${caseId}`,
    text,
    status: "UNRESOLVED",
    confidence: "LOW",
    evidenceIds: [`synthetic-evidence-${caseId}`],
    contradictoryEvidenceIds: [],
    temporalQualifiers: { effectiveAt: null, period: null },
    basis: "SOURCE_REPORT",
  };
}

function syntheticKnowledge(finding: KnowledgeFinding): KnowledgeOutcome {
  return {
    kind: "KNOWLEDGE",
    objective: "Synthetic preserved live-output replay; factual content is not asserted as real-world truth.",
    acceptedUnderstanding:
      "Synthetic preserved live-output replay; factual content is not asserted as real-world truth.",
    findings: [finding],
    uncertainties: ["Synthetic semantic fixture only."],
    provenance: [],
    truthAssessmentIds: [],
  };
}

function syntheticRun(caseId: string): LatticeRun {
  return {
    id: `synthetic-preserved-live-run-${caseId}`,
    conversationId: "synthetic-preserved-live-conversation",
    status: "COMPLETED",
    version: 1,
    request: {
      kind: "consultation",
      objective: "Synthetic preserved live-output replay; factual content is not asserted as real-world truth.",
      context: [FOLLOW_UP],
      decisionNeed: "NONE",
      resourceNeed: "NONE",
      sourceMessageId: `synthetic-preserved-live-message-${caseId}`,
      sourceMessageDigest: "0".repeat(64),
      intentVersion: 1,
    },
    decision: null,
    explanation: null,
    truthAssessmentIds: [],
    events: [],
  };
}

async function replayPreservedLiveOutput(
  fixture: (typeof PRESERVED_CASES)[number],
): Promise<{
  readonly guardResult: string | null;
  readonly presentation: string;
  readonly canonicalUnchanged: boolean;
}> {
  const finding = syntheticFinding(fixture.id, fixture.canonical);
  const knowledge = syntheticKnowledge(finding);
  const run = syntheticRun(fixture.id);
  const model = `preserved-live-output-${fixture.id}`;
  const request = buildKnowledgeSimplificationRequest(model, finding);
  const provider = new DeterministicFixtureModelProvider([{
    id: `preserved-live-output-${fixture.id}`,
    request,
    response: {
      id: `preserved-live-response-${fixture.id}`,
      model,
      output: [{ type: "text", text: fixture.raw }],
    },
  }]);
  const simplifier = new ModelKnowledgeSimplifier(new ModelRuntime(provider), model);
  const canonicalBefore = structuredClone(knowledge);

  const guardResult = validateKnowledgeSimplification(fixture.canonical, fixture.raw);
  const presentation = await renderKnowledgeResponseForRun(knowledge, run, simplifier);

  return {
    guardResult,
    presentation,
    canonicalUnchanged: JSON.stringify(knowledge) === JSON.stringify(canonicalBefore),
  };
}

test("typographic apostrophe negation is detected without mutating accepted wording", () => {
  const original =
    "The available measurements do not establish that additive Q causes the observed failure; they suggest only a possible association.";
  const candidate =
    "The measurements we have don’t show that additive Q causes the failure; they only suggest a possible association.";

  assert.equal(validateKnowledgeSimplification(original, candidate), candidate);
  assert.match(candidate, /don’t/u);
});

test("real negation loss remains fail-closed", () => {
  const original =
    "The measurements do not establish that additive Q causes the failure; they suggest only a possible association.";
  const candidate =
    "The measurements establish that additive Q causes the failure; they suggest only a possible association.";

  assert.equal(validateKnowledgeSimplification(original, candidate), null);
});

test("uncertainty loss remains fail-closed", () => {
  const original =
    "The measurements do not establish that additive Q causes the failure; they suggest only a possible association.";
  const candidate =
    "The measurements do not establish that additive Q causes the failure; they only link additive Q to the failure.";

  assert.equal(validateKnowledgeSimplification(original, candidate), null);
});

test("preserved live A/B/C outputs replay through the guard and final Solandra presentation", async (t) => {
  for (const fixture of PRESERVED_CASES) {
    await t.test(`preserved Case ${fixture.id}`, async () => {
      const result = await replayPreservedLiveOutput(fixture);
      assert.equal(result.guardResult, fixture.raw);
      assert.equal(
        result.presentation,
        `Unresolved as a source report: ${fixture.raw} ${SOURCE_REPORT_SUFFIX}`,
      );
      assert.equal(result.canonicalUnchanged, true);

      if (fixture.id === "B") {
        assert.match(result.presentation, /don’t show/u);
        assert.doesNotMatch(result.presentation, /available measurements do not establish/u);
      }
    });
  }
});
