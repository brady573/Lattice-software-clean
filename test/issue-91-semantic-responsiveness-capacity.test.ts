import assert from "node:assert/strict";
import test from "node:test";
import type { LatticeRunRequest } from "../src/domain.js";
import type {
  KnowledgeAcquisitionProvider,
  KnowledgeAcquisitionRequest,
  KnowledgeAcquisitionResult,
  RetrievedKnowledgeClaim,
  RetrievedKnowledgeSource,
} from "../src/knowledge/acquisition.js";
import { RelevantKnowledgeAcquisitionProvider } from "../src/knowledge/investigation.js";
import { stableModelJson, validateCanonicalModelRequest } from "../src/model/canonical.js";
import type { ModelProvider } from "../src/model/provider.js";
import { ModelRuntime } from "../src/model/runtime.js";
import type { CanonicalModelRequest } from "../src/model/types.js";
import { ModelSolandraKnowledgeInvestigator } from "../src/solandra/knowledge-investigator.js";
import {
  KnowledgeAcquisitionTruthPipeline,
  type KnowledgeEvidenceAdmissionPolicy,
} from "../src/truth/knowledge-acquisition-pipeline.js";

const MODEL = "capacity-test-model";
const FIXED_TIME = "2026-09-14T01:00:00.000Z";
const MAX_CANONICAL_MESSAGE_CHARS = 64 * 1024;
const MAX_CANONICAL_REQUEST_BYTES = 256 * 1024;

function source(index: number, content = `source body ${index}`): RetrievedKnowledgeSource {
  return {
    sourceId: `source:${index}`,
    canonicalUri: `https://example.test/source/${index}`,
    title: `Source ${index}`,
    publisher: "Example Publisher",
    retrievedAt: FIXED_TIME,
    publishedAt: null,
    contentType: "text/plain",
    content,
  };
}

function claim(index: number, sourceIndex: number, text = `Candidate proposition ${index}.`): RetrievedKnowledgeClaim {
  const sourceId = `source:${sourceIndex}`;
  return {
    claimId: `claim:${index}`,
    text,
    claimType: "INTERPRETIVE",
    evidence: [{ sourceId, relation: "SUPPORTS", excerpt: text }],
  };
}

function responsivenessInput(
  sources: readonly RetrievedKnowledgeSource[],
  claims: readonly RetrievedKnowledgeClaim[],
) {
  return {
    runId: "capacity-run",
    objective: "Explain the observed mechanism using relevant external information.",
    context: ["Keep the explanation focused on the mechanism."],
    knowledgeNeeds: ["Identify source material that explains the mechanism."],
    retrievalQueries: ["observed mechanism explanatory evidence"],
    sources,
    claims,
  } as const;
}

function userContent(request: CanonicalModelRequest): string {
  return request.messages.find((message) => message.role === "user")?.content ?? "";
}

function responseSelections(request: CanonicalModelRequest) {
  const content = userContent(request);
  const pattern = /^Claim ID: ([^\n]+)\nClaim: [^\n]*\nEvidence source IDs: ([^\n]+)$/gmu;
  return [...content.matchAll(pattern)].map((match) => ({
    claimId: match[1]!,
    sourceIds: match[2]!.split(" | ").filter((value) => value !== "none"),
  }));
}

class RecordingModelProvider implements ModelProvider {
  readonly kind = "recording-capacity-model";
  readonly requests: CanonicalModelRequest[] = [];
  private responsivenessCalls = 0;

  constructor(
    private readonly responsivenessOutput?: (
      request: CanonicalModelRequest,
      callIndex: number,
    ) => readonly { claimId: string; sourceIds: readonly string[] }[],
  ) {}

  async generate(request: CanonicalModelRequest) {
    this.requests.push(structuredClone(request));
    const system = request.messages.find((message) => message.role === "system")?.content ?? "";
    const body = system.includes("Knowledge investigation cognition")
      ? { retrievalQueries: ["observed mechanism explanatory evidence"] }
      : {
          selections: this.responsivenessOutput?.(request, this.responsivenessCalls++)
            ?? responseSelections(request),
        };
    return {
      response: {
        id: `capacity-response-${this.requests.length}`,
        model: request.model,
        output: [{ type: "text" as const, text: JSON.stringify(body) }],
      },
    };
  }
}

function investigator(provider = new RecordingModelProvider()) {
  return {
    provider,
    investigator: new ModelSolandraKnowledgeInvestigator(new ModelRuntime(provider), MODEL),
  };
}

function semanticRequests(provider: RecordingModelProvider): CanonicalModelRequest[] {
  return provider.requests.filter((request) =>
    (request.messages.find((message) => message.role === "system")?.content ?? "")
      .includes("semantic responsiveness boundary")
  );
}

function claimIdsInRequest(request: CanonicalModelRequest): string[] {
  return [...userContent(request).matchAll(/^Claim ID: ([^\n]+)$/gmu)].map((match) => match[1]!);
}

test("Issue #91: compact responsiveness request removes duplicated source bodies and preserves exact candidate identity", async () => {
  const bodyMarker = `SOURCE_BODY_MUST_NOT_ENTER_RESPONSIVENESS_${"x".repeat(20_000)}`;
  const sources = [source(0, bodyMarker), source(1, bodyMarker)];
  const claims = [
    claim(0, 0, "First exact source-bound candidate proposition."),
    claim(1, 1, "Second exact source-bound candidate proposition."),
  ];
  const { provider, investigator: modelInvestigator } = investigator();

  const result = await modelInvestigator.selectResponsive(responsivenessInput(sources, claims));
  const requests = semanticRequests(provider);
  assert.equal(requests.length, 1, "small candidate sets should use one responsiveness call");
  const request = requests[0]!;
  validateCanonicalModelRequest(request);
  const content = userContent(request);
  assert.doesNotMatch(content, /SOURCE_BODY_MUST_NOT_ENTER_RESPONSIVENESS/u);
  assert.doesNotMatch(content, /Content preview:/u);
  assert.match(content, /Source ID: source:0/u);
  assert.match(content, /Title: Source 0/u);
  assert.match(content, /Publisher: Example Publisher/u);
  assert.match(content, /Claim ID: claim:0/u);
  assert.match(content, /Claim: First exact source-bound candidate proposition\./u);
  assert.match(content, /Evidence source IDs: source:0/u);
  assert.deepEqual(result.selections.map((selection) => selection.claimId), ["claim:0", "claim:1"]);
});

test("Issue #91: structurally oversized candidates are fully covered exactly once by bounded original-order batches", async () => {
  const sources = Array.from({ length: 12 }, (_, index) =>
    source(index, `DUPLICATED_SOURCE_BODY_${index}_${"z".repeat(20_000)}`)
  );
  const claims = Array.from({ length: 96 }, (_, index) =>
    claim(index, index % sources.length, `Candidate ${index}: ${"x".repeat(1_100)}`)
  );
  const expectedClaimIds = claims.map((item) => item.claimId);
  const { provider, investigator: modelInvestigator } = investigator();

  const result = await modelInvestigator.selectResponsive(responsivenessInput(sources, claims));
  const requests = semanticRequests(provider);
  assert.ok(requests.length > 1, "maximum legitimate candidate material must partition when one request cannot fit");

  const presentedClaimIds = requests.flatMap((request) => {
    validateCanonicalModelRequest(request);
    const serialized = stableModelJson(request);
    const requestBytes = Buffer.byteLength(serialized, "utf8");
    assert.ok(requestBytes <= MAX_CANONICAL_REQUEST_BYTES);
    for (const message of request.messages) {
      assert.ok(message.content.length <= MAX_CANONICAL_MESSAGE_CHARS);
    }
    assert.doesNotMatch(userContent(request), /DUPLICATED_SOURCE_BODY_/u);
    return claimIdsInRequest(request);
  });

  assert.deepEqual(presentedClaimIds, expectedClaimIds, "batching must preserve original order and cover every claim once");
  assert.equal(new Set(presentedClaimIds).size, claims.length);
  assert.deepEqual(result.selections.map((selection) => selection.claimId), expectedClaimIds);
});

test("Issue #91: batch-local invented identities and invalid claim-source bindings fail closed", async () => {
  const sources = [source(0), source(1)];
  const claims = [claim(0, 0), claim(1, 1)];

  const invented = investigator(new RecordingModelProvider(() => [
    { claimId: "invented-claim", sourceIds: ["source:0"] },
  ])).investigator;
  await assert.rejects(
    invented.selectResponsive(responsivenessInput(sources, claims)),
    /outside its supplied structural batch/u,
  );

  const unbound = investigator(new RecordingModelProvider(() => [
    { claimId: "claim:0", sourceIds: ["source:1"] },
  ])).investigator;
  await assert.rejects(
    unbound.selectResponsive(responsivenessInput(sources, claims)),
    /outside claim claim:0's supplied bindings/u,
  );
});

test("Issue #91: semantic wrapper preserves acquisition completion while exact outer identity validation remains authoritative", async () => {
  const acquisitionResult: KnowledgeAcquisitionResult = {
    sources: [source(0), source(1)],
    claims: [claim(0, 0), claim(1, 1)],
    completion: { status: "PARTIAL", reason: "RATE_LIMITED" },
  };
  const rawProvider: KnowledgeAcquisitionProvider = {
    kind: "partial-capacity-fixture",
    async acquire(_request: KnowledgeAcquisitionRequest) {
      return structuredClone(acquisitionResult);
    },
  };
  const { investigator: modelInvestigator } = investigator();
  const wrapper = new RelevantKnowledgeAcquisitionProvider(rawProvider, modelInvestigator);

  const result = await wrapper.acquire({
    runId: "partial-wrapper-run",
    objective: "Explain the observed mechanism.",
    context: [],
    investigationQueries: ["Find explanatory source material."],
  });

  assert.deepEqual(result.completion, acquisitionResult.completion);
  assert.deepEqual(result.claims.map((item) => item.claimId), ["claim:0", "claim:1"]);
  assert.deepEqual(result.sources.map((item) => item.sourceId), ["source:0", "source:1"]);
});

test("Issue #91: semantic responsiveness still hands exact selections to V36 instead of bypassing admission", async () => {
  const rawProvider: KnowledgeAcquisitionProvider = {
    kind: "v36-capacity-fixture",
    async acquire() {
      return {
        sources: [source(0)],
        claims: [claim(0, 0, "Exact source report for V36 qualification.")],
        completion: { status: "COMPLETE" },
      };
    },
  };
  const { investigator: modelInvestigator } = investigator();
  const responsive = new RelevantKnowledgeAcquisitionProvider(rawProvider, modelInvestigator);
  let dispositionCalls = 0;
  const admission: KnowledgeEvidenceAdmissionPolicy = {
    disposition() {
      dispositionCalls += 1;
      return {
        verification: "UNVERIFIED",
        admitted: false,
        rejectionReason: "Capacity test keeps V36 authoritative.",
        provenanceComponentKey: null,
        provenanceConfidence: "UNKNOWN",
        authoritativePrimary: false,
        establishedProofKinds: [],
      };
    },
  };
  const pipeline = new KnowledgeAcquisitionTruthPipeline(responsive, admission);
  const request: LatticeRunRequest = {
    kind: "consultation",
    objective: "Explain the observed mechanism.",
    context: [],
    investigationQueries: ["Find explanatory source material."],
    decisionNeed: "NONE",
    resourceNeed: "NONE",
    sourceMessageId: "capacity-v36-message",
    sourceMessageDigest: "c".repeat(64),
    intentVersion: 1,
    intentScopeId: "capacity-v36-scope",
    intentVersionId: "capacity-v36-intent",
  };

  const execution = await pipeline.execute("capacity-v36-run", request);
  assert.equal(dispositionCalls, 1, "V36 admission policy must still evaluate selected evidence");
  assert.equal(execution.bundle.claimEvidence.length, 1);
  assert.equal(execution.bundle.claimEvidence[0]?.admitted, false);
  assert.equal(execution.bundle.claimEvidence[0]?.rejectionReason, "Capacity test keeps V36 authoritative.");
});
