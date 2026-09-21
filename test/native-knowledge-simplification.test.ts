import assert from "node:assert/strict";
import test from "node:test";
import type { ModelProvider } from "../src/model/provider.js";
import { ModelRuntime } from "../src/model/runtime.js";
import type { CanonicalModelRequest, ModelCallContext, ModelProviderResult } from "../src/model/types.js";
import type { KnowledgeFinding, KnowledgeOutcome } from "../src/outcome.js";
import { ModelSolandraKnowledgePresenter } from "../src/solandra/knowledge-presenter.js";

class ScriptedPresentationProvider implements ModelProvider {
  readonly kind = "native-knowledge-presentation-fixture";
  readonly requests: CanonicalModelRequest[] = [];

  constructor(private readonly output: unknown) {}

  async generate(request: CanonicalModelRequest, _context: ModelCallContext): Promise<ModelProviderResult> {
    this.requests.push(structuredClone(request));
    return {
      response: {
        id: "native-knowledge-presentation-response",
        model: request.model,
        output: [{ type: "text", text: JSON.stringify(this.output) }],
      },
      route: {
        actualProvider: this.kind,
        actualModel: request.model,
        upstreamRequestId: "native-knowledge-presentation-request",
      },
    };
  }
}

function finding(
  claimId: string,
  text: string,
  status: KnowledgeFinding["status"],
  confidence: KnowledgeFinding["confidence"],
  sourceIndex: number,
): KnowledgeFinding {
  return {
    claimId,
    text,
    status,
    confidence,
    evidenceIds: [`evidence-${sourceIndex}`],
    contradictoryEvidenceIds: status === "CONFLICTED" ? [`contradiction-${sourceIndex}`] : [],
    temporalQualifiers: sourceIndex === 1
      ? { effectiveAt: "2026-09-01T00:00:00.000Z", period: "2026-Q3" }
      : { effectiveAt: null, period: null },
    basis: "CLAIM",
  };
}

function multiFindingKnowledge(): KnowledgeOutcome {
  const findings = [
    finding("claim-supported", "The API may return only 25 items when CACHE-V2 is enabled after 2026-09-01, and it does not guarantee delivery.", "SUPPORTED", "HIGH", 1),
    finding("claim-refuted", "The service does not accept HTTP requests before 08:00 UTC.", "REFUTED", "HIGH", 2),
    finding("claim-conflicted", "If the network path fails, a fallback route could remain available.", "CONFLICTED", "MEDIUM", 3),
    finding("claim-unresolved", "The backup process might finish during the maintenance window.", "UNRESOLVED", "LOW", 4),
  ];
  return {
    kind: "KNOWLEDGE",
    objective: "Present the exact governed operational findings.",
    acceptedUnderstanding: "Present the exact governed operational findings.",
    findings,
    uncertainties: ["Delivery may still be delayed by conditions not established in this Knowledge."],
    provenance: [1, 2, 3, 4].map((index) => ({
      sourceId: `source-${index}`,
      canonicalUri: `https://knowledge.example/source-${index}`,
      title: `Governed source ${index}`,
      publisher: "Knowledge Example",
      provenanceConfidence: "HIGH" as const,
      authoritativePrimary: index === 1,
      evidentiarySuitability: "GENERAL_REFERENCE" as const,
      retrievedAt: "2026-09-20T00:00:00.000Z",
      publishedAt: null,
    })),
    evidence: [
      ...findings.map((item, index) => ({
        evidenceId: `evidence-${index + 1}`,
        claimId: item.claimId,
        sourceId: `source-${index + 1}`,
        relation: "SUPPORTS" as const,
        excerpt: item.text,
        verification: "VERIFIED" as const,
        admitted: true,
        rejectionReason: null,
      })),
      {
        evidenceId: "contradiction-3",
        claimId: "claim-conflicted",
        sourceId: "source-4",
        relation: "CONTRADICTS" as const,
        excerpt: "The fallback route was unavailable in the contradictory observation.",
        verification: "VERIFIED" as const,
        admitted: true,
        rejectionReason: null,
      },
    ],
    truthAssessmentIds: ["assessment-1", "assessment-2", "assessment-3", "assessment-4"],
  };
}

async function present(output: unknown, knowledge: KnowledgeOutcome, mode: "EXPLAIN" | "SIMPLIFY" = "SIMPLIFY") {
  const provider = new ScriptedPresentationProvider(output);
  const presenter = new ModelSolandraKnowledgePresenter(new ModelRuntime(provider), "native-presentation-model");
  const result = await presenter.present({
    knowledgeId: "knowledge-native-presentation",
    userMessageId: "message-native-presentation",
    mode,
    knowledge,
  });
  return { result, provider };
}

test("native simplification paraphrases claim-bound segments while authority metadata stays exact and multi-finding", async () => {
  const knowledge = multiFindingKnowledge();
  const before = structuredClone(knowledge);
  const { result, provider } = await present({
    needsNewKnowledge: false,
    segments: [
      { claimId: "claim-supported", text: "The API may return only 25 items when CACHE-V2 is enabled after 2026-09-01; delivery is not guaranteed." },
      { claimId: "claim-refuted", text: "Before 08:00 UTC, the service does not accept HTTP requests." },
      { claimId: "claim-conflicted", text: "If the network path fails, a fallback route could still be available." },
      { claimId: "claim-unresolved", text: "The backup process might finish during the maintenance window." },
    ],
  }, knowledge);

  assert.equal(result.status, "PRESENTED");
  assert.ok(result.text);
  assert.match(result.text, /API may return only 25 items when CACHE-V2/u);
  assert.doesNotMatch(result.text, /and it does not guarantee delivery/u);
  assert.equal(result.text.match(/Status:/gu)?.length, 4);
  assert.match(result.text, /Status: Supported; confidence: HIGH\./u);
  assert.match(result.text, /Status: Refuted; confidence: HIGH\./u);
  assert.match(result.text, /Status: Materially conflicted; confidence: MEDIUM\./u);
  assert.match(result.text, /Status: Unresolved; confidence: LOW\./u);
  assert.match(result.text, /Effective at: 2026-09-01T00:00:00\.000Z; Period: 2026-Q3/u);
  assert.match(result.text, /Delivery may still be delayed by conditions not established in this Knowledge/u);
  for (let index = 1; index <= 4; index += 1) {
    assert.match(result.text, new RegExp(`https://knowledge\\.example/source-${index}`, "u"));
  }
  assert.deepEqual(knowledge, before, "presentation must not mutate governed Knowledge");
  const requestText = provider.requests[0]?.messages.map((message) => message.content).join("\n") ?? "";
  for (const item of knowledge.findings) assert.match(requestText, new RegExp(item.claimId, "u"));
});

test("bounded fidelity defense rejects dropped negation, modality, conditions, quantities, and technical identifiers", async () => {
  const knowledge = multiFindingKnowledge();
  knowledge.findings = [knowledge.findings[0]!];
  knowledge.evidence = knowledge.evidence?.filter((item) => item.claimId === "claim-supported");
  knowledge.provenance = [knowledge.provenance[0]!];
  const original = knowledge.findings[0]!.text;
  const invalid = [
    "The API may return only 25 items when CACHE-V2 is enabled after 2026-09-01, and delivery is guaranteed.",
    "The API will return only 25 items when CACHE-V2 is enabled after 2026-09-01, and it does not guarantee delivery.",
    "The API may return 25 items with CACHE-V2 enabled from 2026-09-01, and it does not guarantee delivery.",
    "The API may return only 30 items when CACHE-V2 is enabled after 2026-09-01, and it does not guarantee delivery.",
    "The API may return only 25 items when the cache is enabled after 2026-09-01, and it does not guarantee delivery.",
  ];

  for (const text of invalid) {
    const { result } = await present({
      needsNewKnowledge: false,
      segments: [{ claimId: "claim-supported", text }],
    }, knowledge);
    assert.equal(result.status, "FIDELITY_REJECTED");
    assert.ok(result.text);
    assert.match(result.text, new RegExp(original.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }
});

test("invented claim identity is rejected and NEEDS_NEW_KNOWLEDGE never manufactures substitute prose", async () => {
  const knowledge = multiFindingKnowledge();
  const invented = await present({
    needsNewKnowledge: false,
    segments: [{ claimId: "claim-invented", text: "Invented content." }],
  }, knowledge);
  assert.equal(invented.result.status, "FIDELITY_REJECTED");
  assert.ok(invented.result.text);

  const needs = await present({ needsNewKnowledge: true, segments: [] }, knowledge);
  assert.equal(needs.result.status, "NEEDS_NEW_KNOWLEDGE");
  assert.equal(needs.result.text, null);
});

test("EXPLAIN selects exact claims but cannot replace governed wording", async () => {
  const knowledge = multiFindingKnowledge();
  const explained = await present({
    needsNewKnowledge: false,
    segments: [{ claimId: "claim-refuted" }],
  }, knowledge, "EXPLAIN");
  assert.equal(explained.result.status, "PRESENTED");
  assert.ok(explained.result.text);
  assert.match(explained.result.text, /The service does not accept HTTP requests before 08:00 UTC\./u);
  assert.doesNotMatch(explained.result.text, /claim-supported/u);
});
