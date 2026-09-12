import assert from "node:assert/strict";
import test from "node:test";
import type { LatticeRun } from "../src/domain.js";
import type { ModelProvider } from "../src/model/provider.js";
import { ModelRuntime } from "../src/model/runtime.js";
import type {
  CanonicalModelRequest,
  ModelCallContext,
  ModelProviderResult,
} from "../src/model/types.js";
import type { KnowledgeOutcome } from "../src/outcome.js";
import { renderKnowledgeResponseForRun } from "../src/presentation/solandra/knowledge-response.js";
import { ModelSolandraKnowledgePresenter } from "../src/solandra/knowledge-presenter.js";

const GOVERNED = "A stable interface reduces upgrade coupling when clients depend on the documented contract rather than implementation details.";
const SOURCE_REPORT = "The retrieved study reports that corrosion increased after repeated salt-water exposure.";

function knowledge(): KnowledgeOutcome {
  return {
    kind: "KNOWLEDGE",
    objective: "Understand interface stability and the reported corrosion result.",
    acceptedUnderstanding: "Understand interface stability and the reported corrosion result.",
    findings: [
      {
        claimId: "claim-governed",
        text: GOVERNED,
        status: "SUPPORTED",
        confidence: "HIGH",
        evidenceIds: ["evidence-governed"],
        contradictoryEvidenceIds: [],
        temporalQualifiers: { effectiveAt: null, period: null },
        basis: "CLAIM",
      },
      {
        claimId: "claim-source-report",
        text: SOURCE_REPORT,
        status: "UNRESOLVED",
        confidence: "LOW",
        evidenceIds: ["evidence-source-report"],
        contradictoryEvidenceIds: [],
        temporalQualifiers: { effectiveAt: null, period: null },
        basis: "SOURCE_REPORT",
      },
    ],
    uncertainties: ["The corrosion evidence establishes the retrieved report, not a universal corrosion rate."],
    provenance: [{
      sourceId: "source-governed",
      canonicalUri: "https://knowledge.example/governed",
      title: "Governed source",
      publisher: "Knowledge Example",
      provenanceConfidence: "HIGH",
      authoritativePrimary: true,
      evidentiarySuitability: "GENERAL_REFERENCE",
      retrievedAt: "2026-09-12T00:00:00.000Z",
      publishedAt: null,
    }],
    evidence: [
      {
        evidenceId: "evidence-governed",
        claimId: "claim-governed",
        sourceId: "source-governed",
        relation: "SUPPORTS",
        excerpt: GOVERNED,
        verification: "VERIFIED",
        admitted: true,
        rejectionReason: null,
      },
      {
        evidenceId: "evidence-source-report",
        claimId: "claim-source-report",
        sourceId: "source-governed",
        relation: "SUPPORTS",
        excerpt: SOURCE_REPORT,
        verification: "VERIFIED",
        admitted: true,
        rejectionReason: null,
      },
    ],
    truthAssessmentIds: ["assessment-governed", "assessment-source-report"],
  };
}

class PresentationProvider implements ModelProvider {
  readonly kind = "issues-43-47-presentation-provider";

  constructor(private readonly output: unknown) {}

  async generate(request: CanonicalModelRequest, _context: ModelCallContext): Promise<ModelProviderResult> {
    return {
      response: {
        id: "issues-43-47-response",
        model: request.model,
        output: [{ type: "text", text: JSON.stringify(this.output) }],
      },
      route: {
        actualProvider: this.kind,
        actualModel: request.model,
        upstreamRequestId: "issues-43-47-request",
      },
    };
  }
}

async function present(output: unknown, mode: "EXPLAIN" | "SIMPLIFY" = "EXPLAIN") {
  const presenter = new ModelSolandraKnowledgePresenter(
    new ModelRuntime(new PresentationProvider(output)),
    "issues-43-47-model",
  );
  return await presenter.present({
    knowledgeId: "knowledge-issues-43-47",
    userMessageId: "message-issues-43-47",
    mode,
    knowledge: knowledge(),
  });
}

function run(objective: string): LatticeRun {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    request: { kind: "consultation", objective, context: [] },
  } as unknown as LatticeRun;
}

test("#43 selected governed claim renders authoritative finding text with structural uncertainty and provenance", async () => {
  const result = await present({
    needsNewKnowledge: false,
    segments: [{ claimId: "claim-source-report" }, { claimId: "claim-governed" }],
  }, "SIMPLIFY");

  assert.equal(result.status, "PRESENTED");
  assert.ok(result.text);
  assert.match(result.text, new RegExp(SOURCE_REPORT.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.match(result.text, new RegExp(GOVERNED.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.match(result.text, /Unresolved as a source report:/u);
  assert.match(result.text, /does not independently verify the broader real-world claim/u);
  assert.match(result.text, /Known uncertainty:/u);
  assert.match(result.text, /corrosion evidence establishes the retrieved report/u);
  assert.match(result.text, /Governed source — Knowledge Example/u);
  assert.match(result.text, /https:\/\/knowledge\.example\/governed/u);
});

test("#43 generated subject-object replacement prose cannot acquire governed claim authority", async () => {
  const result = await present({
    needsNewKnowledge: false,
    segments: [{
      claimId: "claim-governed",
      text: "Implementation details depend on clients, so interface stability increases upgrade coupling.",
    }],
  });

  assert.equal(result.status, "FIDELITY_REJECTED");
  assert.equal(result.text, null);
});

test("#43 generated causal-direction replacement prose cannot acquire governed claim authority", async () => {
  const result = await present({
    needsNewKnowledge: false,
    segments: [{
      claimId: "claim-source-report",
      text: "Salt-water exposure decreased because corrosion increased.",
    }],
  });

  assert.equal(result.status, "FIDELITY_REJECTED");
  assert.equal(result.text, null);
});

test("#43 invented and duplicate claim selections remain rejected structurally", async () => {
  const invented = await present({
    needsNewKnowledge: false,
    segments: [{ claimId: "invented-claim" }],
  });
  assert.equal(invented.status, "FIDELITY_REJECTED");

  const duplicate = await present({
    needsNewKnowledge: false,
    segments: [{ claimId: "claim-governed" }, { claimId: "claim-governed" }],
  });
  assert.equal(duplicate.status, "FIDELITY_REJECTED");
});

test("#47 governed causal material is presented without causal verb-marker eligibility", async () => {
  const text = "Moisture and oxygen are present at the metal surface. Iron oxide formation follows in the observed conditions.";
  const value = knowledge();
  value.objective = "Why did the observed sample corrode?";
  value.acceptedUnderstanding = value.objective;
  value.findings = [{
    claimId: "claim-no-causal-marker",
    text,
    status: "SUPPORTED",
    confidence: "HIGH",
    evidenceIds: ["evidence-governed"],
    contradictoryEvidenceIds: [],
    temporalQualifiers: { effectiveAt: null, period: null },
    basis: "CLAIM",
  }];
  value.uncertainties = [];

  const response = await renderKnowledgeResponseForRun(value, run(value.objective));
  assert.match(response, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.doesNotMatch(response, /doesn't contain a direct explanation|unsupported meaning/iu);
});

test("#47 canonical finding order does not let first-sentence position erase a governed condition", async () => {
  const text = "The interface remains stable. Compatibility is preserved only when clients rely on the documented contract.";
  const value = knowledge();
  value.objective = "Describe the governed compatibility finding.";
  value.acceptedUnderstanding = value.objective;
  value.findings = [{
    claimId: "claim-condition-second",
    text,
    status: "SUPPORTED",
    confidence: "HIGH",
    evidenceIds: ["evidence-governed"],
    contradictoryEvidenceIds: [],
    temporalQualifiers: { effectiveAt: null, period: null },
    basis: "CLAIM",
  }];
  value.uncertainties = [];

  const response = await renderKnowledgeResponseForRun(value, run(value.objective));
  assert.match(response, /The interface remains stable\./u);
  assert.match(response, /Compatibility is preserved only when clients rely on the documented contract\./u);
});
