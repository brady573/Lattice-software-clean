import assert from "node:assert/strict";
import test from "node:test";
import type { ModelProvider } from "../src/model/provider.js";
import { ModelRuntime } from "../src/model/runtime.js";
import type { CanonicalModelRequest, ModelCallContext, ModelProviderResult } from "../src/model/types.js";
import type { KnowledgeFinding, KnowledgeOutcome } from "../src/outcome.js";
import {
  ModelSolandraKnowledgePresenter,
  validateKnowledgePresentationRewrite,
} from "../src/solandra/knowledge-presenter.js";

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
    finding("claim-conflicted", "If the network path fails, a fallback route could remain available.", "CONFLICTED", "MODERATE", 3),
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

function mixedRiskKnowledge(): KnowledgeOutcome {
  const knowledge = multiFindingKnowledge();
  const lowRisk = finding(
    "claim-low-risk",
    "The archive stores reports in a public catalog.",
    "SUPPORTED",
    "HIGH",
    5,
  );
  knowledge.findings = [...knowledge.findings, lowRisk];
  knowledge.provenance = [
    ...knowledge.provenance,
    {
      sourceId: "source-5",
      canonicalUri: "https://knowledge.example/source-5",
      title: "Governed source 5",
      publisher: "Knowledge Example",
      provenanceConfidence: "HIGH",
      authoritativePrimary: false,
      evidentiarySuitability: "GENERAL_REFERENCE",
      retrievedAt: "2026-09-20T00:00:00.000Z",
      publishedAt: null,
    },
  ];
  knowledge.evidence = [
    ...(knowledge.evidence ?? []),
    {
      evidenceId: "evidence-5",
      claimId: lowRisk.claimId,
      sourceId: "source-5",
      relation: "SUPPORTS",
      excerpt: lowRisk.text,
      verification: "VERIFIED",
      admitted: true,
      rejectionReason: null,
    },
  ];
  knowledge.truthAssessmentIds = [...knowledge.truthAssessmentIds, "assessment-5"];
  return knowledge;
}

test("exact governed wording stays safe while a low-risk claim can simplify inside a multi-finding presentation", async () => {
  const knowledge = mixedRiskKnowledge();
  const before = structuredClone(knowledge);
  const { result, provider } = await present({
    needsNewKnowledge: false,
    segments: [
      ...knowledge.findings.slice(0, 4).map((item) => ({ claimId: item.claimId, text: item.text })),
      { claimId: "claim-low-risk", text: "The archive keeps reports in a public catalog." },
    ],
  }, knowledge);

  assert.equal(result.status, "PRESENTED");
  assert.ok(result.text);
  assert.match(result.text, /The archive keeps reports in a public catalog\./u);
  assert.match(result.text, /The API may return only 25 items when CACHE-V2/u);
  assert.match(result.text, /The service does not accept HTTP requests before 08:00 UTC\./u);
  assert.equal(result.text.match(/Status:/gu)?.length, 5);
  assert.match(result.text, /Status: Supported; confidence: HIGH\./u);
  assert.match(result.text, /Status: Materially conflicted; confidence: MODERATE\./u);
  assert.match(result.text, /Status: Unresolved; confidence: LOW\./u);
  assert.match(result.text, /Effective at: 2026-09-01T00:00:00\.000Z; Period: 2026-Q3/u);
  assert.match(result.text, /Delivery may still be delayed by conditions not established in this Knowledge/u);
  for (let index = 1; index <= 5; index += 1) {
    assert.match(result.text, new RegExp("https://knowledge\\.example/source-" + index, "u"));
  }
  assert.deepEqual(knowledge, before, "presentation must not mutate governed Knowledge");
  const requestText = provider.requests[0]?.messages.map((message) => message.content).join("\n") ?? "";
  for (const item of knowledge.findings) assert.match(requestText, new RegExp(item.claimId, "u"));
});

test("fidelity guard fails closed on changed high-risk material instead of treating marker presence as semantic proof", () => {
  const cases = [
    {
      label: "negation reassociation",
      original: "The service does not accept requests, and the audit log records failures.",
      candidate: "The service accepts requests, and the audit log does not record failures.",
    },
    {
      label: "modality reassociation",
      original: "The primary route may remain available, and the backup route remains unavailable.",
      candidate: "The primary route remains available, and the backup route may remain unavailable.",
    },
    {
      label: "condition reassociation",
      original: "If the cache is warm, the service returns the stored result, and the audit remains available.",
      candidate: "The cache is warm, the service returns the stored result if the audit remains available.",
    },
    {
      label: "identifier quantity and date reassociation",
      original: "CACHE-V2 records 25 entries after 2026-09-01, and the archive retains the batch.",
      candidate: "After 2026-09-01 the archive retains 25 entries, and CACHE-V2 records the batch.",
    },
  ] as const;

  for (const item of cases) {
    assert.equal(
      validateKnowledgePresentationRewrite(item.original, item.candidate),
      null,
      item.label,
    );
  }
});

test("fidelity guard accepts exact wording and bounded low-risk rewrites without claiming semantic authority", () => {
  const unchanged = "The primary route may remain available if the cache is warm.";
  assert.equal(validateKnowledgePresentationRewrite(unchanged, unchanged), unchanged);

  const lowRiskOriginal = "The archive stores reports in a public catalog.";
  const lowRiskCandidate = "The archive keeps reports in a public catalog.";
  assert.equal(
    validateKnowledgePresentationRewrite(lowRiskOriginal, lowRiskCandidate),
    lowRiskCandidate,
  );
});

test("unsafe transformed high-risk wording falls back to exact governed Knowledge without mutation", async () => {
  const knowledge = multiFindingKnowledge();
  knowledge.findings = [knowledge.findings[0]!];
  knowledge.evidence = (knowledge.evidence ?? []).filter((item) => item.claimId === "claim-supported");
  knowledge.provenance = [knowledge.provenance[0]!];
  knowledge.truthAssessmentIds = [knowledge.truthAssessmentIds[0]!];
  const before = structuredClone(knowledge);
  const original = knowledge.findings[0]!.text;
  const unsafe = "The API may not return only 25 items when CACHE-V2 is enabled after 2026-09-01, and it does guarantee delivery.";

  const { result, provider } = await present({
    needsNewKnowledge: false,
    segments: [{ claimId: "claim-supported", text: unsafe }],
  }, knowledge);

  assert.equal(result.status, "FIDELITY_REJECTED");
  assert.ok(result.text);
  assert.equal(result.text.includes(original), true);
  assert.equal(result.text.includes(unsafe), false);
  assert.match(result.text, /Status: Supported; confidence: HIGH\./u);
  assert.match(result.text, /Effective at: 2026-09-01T00:00:00\.000Z; Period: 2026-Q3/u);
  assert.match(result.text, /https:\/\/knowledge\.example\/source-1/u);
  assert.deepEqual(knowledge, before, "rejected presentation must not mutate governed Knowledge");
  assert.equal(provider.requests.length, 1, "fallback must not launch a second model or acquisition path");
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
