import assert from "node:assert/strict";
import test from "node:test";
import type { LatticeRun } from "../src/domain.js";
import type { KnowledgeOutcome } from "../src/outcome.js";
import { renderKnowledgeResponseForRun } from "../src/presentation/solandra/knowledge-response.js";

function run(objective: string): LatticeRun {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    request: {
      kind: "consultation",
      objective,
      context: [],
    },
  } as unknown as LatticeRun;
}

function knowledge(objective: string, text: string): KnowledgeOutcome {
  return {
    kind: "KNOWLEDGE",
    objective,
    acceptedUnderstanding: objective,
    findings: [{
      claimId: "claim-a",
      text,
      status: "UNRESOLVED",
      confidence: "LOW",
      evidenceIds: ["evidence-a"],
      contradictoryEvidenceIds: [],
      temporalQualifiers: { effectiveAt: null, period: null },
      basis: "SOURCE_REPORT",
    }],
    uncertainties: [],
    provenance: [{
      sourceId: "source-a",
      canonicalUri: "https://knowledge.example/source-a",
      title: "Source A",
      publisher: "Knowledge Example",
      provenanceConfidence: "HIGH",
      authoritativePrimary: true,
      evidentiarySuitability: "GENERAL_REFERENCE",
      retrievedAt: "2026-09-06T17:00:00.000Z",
      publishedAt: null,
    }],
    evidence: [],
    truthAssessmentIds: ["assessment-a"],
  };
}

test("A1 direct causal response carries no factual words absent from governed finding except presentation qualification", async () => {
  const objective = "Why does cast iron rust?";
  const finding = "Cast iron rusts because iron reacts with oxygen and water, forming iron oxides.";
  const response = await renderKnowledgeResponseForRun(knowledge(objective, finding), run(objective));

  assert.match(response, new RegExp(finding.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.match(response, /retrieved source material reports/iu);
  assert.match(response, /does not by itself independently verify/iu);
  assert.doesNotMatch(response, /therefore|so you should|usually|always|safe|recommended/iu);
});
