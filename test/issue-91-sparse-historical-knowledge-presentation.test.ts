import assert from "node:assert/strict";
import test from "node:test";
import type { ModelProvider } from "../src/model/provider.js";
import { ModelRuntime } from "../src/model/runtime.js";
import type {
  CanonicalModelRequest,
  ModelCallContext,
  ModelProviderResult,
} from "../src/model/types.js";
import type { KnowledgeOutcome } from "../src/outcome.js";
import { ModelSolandraKnowledgePresenter } from "../src/solandra/knowledge-presenter.js";

const UNCERTAINTY = "No sufficiently relevant validated evidence was established for this objective.";
const UNRESOLVED = "The available evidence did not establish whether the archive published the requested report.";

function sparseKnowledge(): KnowledgeOutcome {
  return {
    kind: "KNOWLEDGE",
    objective: "Determine whether the archive published the requested report.",
    acceptedUnderstanding: "Determine whether the archive published the requested report.",
    findings: [],
    uncertainties: [UNCERTAINTY],
    provenance: [],
    evidence: [],
    truthAssessmentIds: [],
  };
}

function unresolvedKnowledge(): KnowledgeOutcome {
  return {
    kind: "KNOWLEDGE",
    objective: "Determine whether the archive published the requested report.",
    acceptedUnderstanding: "Determine whether the archive published the requested report.",
    findings: [{
      claimId: "claim-unresolved",
      text: UNRESOLVED,
      status: "UNRESOLVED",
      confidence: "LOW",
      evidenceIds: [],
      contradictoryEvidenceIds: [],
      temporalQualifiers: { effectiveAt: null, period: null },
      basis: "CLAIM",
    }],
    uncertainties: [UNCERTAINTY],
    provenance: [],
    evidence: [],
    truthAssessmentIds: ["assessment-unresolved"],
  };
}

class NeverCalledProvider implements ModelProvider {
  readonly kind = "issue-91-never-called";
  calls = 0;

  async generate(_request: CanonicalModelRequest, _context: ModelCallContext): Promise<ModelProviderResult> {
    this.calls += 1;
    throw new Error("Sparse historical presentation must not invoke a model to restate structural absence.");
  }
}

class PresentationProvider implements ModelProvider {
  readonly kind = "issue-91-presentation-provider";

  constructor(private readonly output: unknown) {}

  async generate(request: CanonicalModelRequest, _context: ModelCallContext): Promise<ModelProviderResult> {
    return {
      response: {
        id: "issue-91-presentation-response",
        model: request.model,
        output: [{ type: "text", text: JSON.stringify(this.output) }],
      },
      route: {
        actualProvider: this.kind,
        actualModel: request.model,
        upstreamRequestId: "issue-91-presentation-request",
      },
    };
  }
}

test("sparse historical Knowledge presents exact absence and uncertainty without new acquisition machinery", async () => {
  const provider = new NeverCalledProvider();
  const presenter = new ModelSolandraKnowledgePresenter(new ModelRuntime(provider), "issue-91-sparse-presenter");

  const result = await presenter.present({
    knowledgeId: "knowledge-sparse-history",
    userMessageId: "message-sparse-history",
    mode: "EXPLAIN",
    knowledge: sparseKnowledge(),
  });

  assert.equal(provider.calls, 0);
  assert.equal(result.status, "PRESENTED");
  assert.ok(result.text);
  assert.match(result.text, /contains no governed findings/u);
  assert.match(result.text, new RegExp(UNCERTAINTY.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.match(result.text, /No admitted source is linked to this established Knowledge/u);
  assert.equal(result.invocationProvenance.actualProvider, null);
  assert.equal(result.invocationProvenance.routeProvenance, "MISSING");
});

test("source-empty unresolved Knowledge reports source absence while preserving the governed finding", async () => {
  const presenter = new ModelSolandraKnowledgePresenter(
    new ModelRuntime(new PresentationProvider({
      needsNewKnowledge: false,
      segments: [{ claimId: "claim-unresolved" }],
    })),
    "issue-91-unresolved-presenter",
  );

  const result = await presenter.present({
    knowledgeId: "knowledge-unresolved-history",
    userMessageId: "message-unresolved-history",
    mode: "EXPLAIN",
    knowledge: unresolvedKnowledge(),
  });

  assert.equal(result.status, "PRESENTED");
  assert.ok(result.text);
  assert.match(result.text, new RegExp(UNRESOLVED.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.match(result.text, new RegExp(UNCERTAINTY.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.match(result.text, /No admitted source is linked to this established Knowledge/u);
});

test("NEEDS_NEW_KNOWLEDGE remains available when presentation requires facts beyond non-sparse Knowledge", async () => {
  const presenter = new ModelSolandraKnowledgePresenter(
    new ModelRuntime(new PresentationProvider({ needsNewKnowledge: true, segments: [] })),
    "issue-91-new-knowledge-presenter",
  );

  const result = await presenter.present({
    knowledgeId: "knowledge-needs-more",
    userMessageId: "message-needs-more",
    mode: "EXPLAIN",
    knowledge: unresolvedKnowledge(),
  });

  assert.equal(result.status, "NEEDS_NEW_KNOWLEDGE");
  assert.equal(result.text, null);
  assert.equal(result.invocationProvenance.actualProvider, "issue-91-presentation-provider");
});
