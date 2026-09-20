import assert from "node:assert/strict";
import test from "node:test";
import type { LatticeRun, LatticeRunRequest } from "../src/domain.js";
import type {
  KnowledgeAcquisitionProvider,
  KnowledgeAcquisitionRequest,
  KnowledgeAcquisitionResult,
} from "../src/knowledge/acquisition.js";
import {
  RelevantKnowledgeAcquisitionProvider,
  type KnowledgeInvestigator,
} from "../src/knowledge/investigation.js";
import { buildKnowledgeOutcome } from "../src/outcome.js";
import type { ModelProvider } from "../src/model/provider.js";
import { ModelRuntime } from "../src/model/runtime.js";
import { ModelSolandraKnowledgeInvestigator } from "../src/solandra/knowledge-investigator.js";
import { renderKnowledgeResponseForRun } from "../src/presentation/solandra/knowledge-response.js";
import {
  KnowledgeAcquisitionTruthPipeline,
  type KnowledgeEvidenceAdmissionPolicy,
} from "../src/truth/knowledge-acquisition-pipeline.js";

const baseRequest: LatticeRunRequest = {
  kind: "consultation",
  objective: "Explain how a lunar eclipse happens.",
  context: [],
  investigationQueries: ["external explanation"],
  advisoryRequested: false,
  decisionNeed: "NONE",
  resourceNeed: "NONE",
  sourceMessageId: "knowledge-boundary-message",
  sourceMessageDigest: "a".repeat(64),
  intentVersion: 1,
  intentScopeId: "knowledge-boundary-scope",
  intentVersionId: "knowledge-boundary-intent",
};

function run(id: string, request: LatticeRunRequest = baseRequest): LatticeRun {
  return {
    id,
    conversationId: "knowledge-boundary-conversation",
    status: "COMPLETED",
    version: 1,
    request,
    decision: null,
    explanation: null,
    truthAssessmentIds: [],
    events: [],
  };
}

function answerableResult(
  completion: NonNullable<KnowledgeAcquisitionResult["completion"]> = { status: "COMPLETE" },
): KnowledgeAcquisitionResult {
  const text = "A lunar eclipse occurs when Earth passes between the Sun and the Moon, placing the Moon in Earth's shadow.";
  return {
    sources: [{
      sourceId: "source-lunar",
      canonicalUri: "https://example.test/lunar-eclipse",
      title: "Lunar eclipse reference",
      publisher: "Example Reference",
      retrievedAt: "2026-09-20T00:00:00.000Z",
      publishedAt: null,
      contentType: "text/plain",
      content: text,
      metadata: { evidentiarySuitability: "GENERAL_REFERENCE" },
    }],
    claims: [{
      claimId: "claim-lunar",
      text,
      claimType: "INTERPRETIVE",
      evidence: [{ sourceId: "source-lunar", relation: "SUPPORTS", excerpt: text }],
    }],
    completion,
  };
}

class FixedProvider implements KnowledgeAcquisitionProvider {
  readonly kind = "knowledge-boundary-fixed-provider";

  constructor(
    private readonly result: KnowledgeAcquisitionResult | Error,
  ) {}

  async acquire(_request: KnowledgeAcquisitionRequest): Promise<KnowledgeAcquisitionResult> {
    if (this.result instanceof Error) throw this.result;
    return structuredClone(this.result);
  }
}

function investigator(options: {
  planError?: Error;
  selectionError?: Error;
  select?: "all" | "none";
} = {}): KnowledgeInvestigator {
  return {
    kind: "knowledge-boundary-investigator",
    async plan() {
      if (options.planError) throw options.planError;
      return { retrievalQueries: ["lunar eclipse mechanism"] };
    },
    async selectResponsive(input) {
      if (options.selectionError) throw options.selectionError;
      if (options.select === "none") return { selections: [] };
      return {
        selections: input.claims.map((claim) => ({
          claimId: claim.claimId,
          sourceIds: claim.evidence.map((item) => item.sourceId),
        })),
      };
    },
  };
}

test("investigation cognition failure remains a capability failure instead of no-evidence insufficiency", async () => {
  const pipeline = new KnowledgeAcquisitionTruthPipeline(new RelevantKnowledgeAcquisitionProvider(
    new FixedProvider(answerableResult()),
    investigator({ planError: new Error("injected model runtime failure") }),
  ));
  const execution = await pipeline.execute("knowledge-investigation-failure", baseRequest);
  const knowledge = buildKnowledgeOutcome(run("knowledge-investigation-failure"), execution.bundle);

  assert.equal(knowledge.availability, "INVESTIGATION_UNAVAILABLE");
  assert.deepEqual(knowledge.findings, []);
  const message = await renderKnowledgeResponseForRun(knowledge, run("knowledge-investigation-failure"));
  assert.match(message, /couldn't complete the external investigation/iu);
  assert.doesNotMatch(message, /couldn't establish enough relevant evidence/iu);
  assert.doesNotMatch(JSON.stringify(execution.bundle), /injected model runtime failure/iu);
});

test("actual model-investigator provider failure crosses as investigation-unavailable", async () => {
  const failingModel: ModelProvider = {
    kind: "knowledge-boundary-failing-model",
    async generate() {
      throw new Error("injected model transport failure");
    },
  };
  const modelInvestigator = new ModelSolandraKnowledgeInvestigator(
    new ModelRuntime(failingModel),
    "knowledge-boundary-model",
  );
  const pipeline = new KnowledgeAcquisitionTruthPipeline(new RelevantKnowledgeAcquisitionProvider(
    new FixedProvider(answerableResult()),
    modelInvestigator,
  ));

  const execution = await pipeline.execute("knowledge-model-investigation-failure", baseRequest);
  const knowledge = buildKnowledgeOutcome(run("knowledge-model-investigation-failure"), execution.bundle);

  assert.equal(knowledge.availability, "INVESTIGATION_UNAVAILABLE");
  assert.deepEqual(knowledge.findings, []);
  assert.doesNotMatch(JSON.stringify(execution.bundle), /injected model transport failure/iu);
});

test("raw source acquisition failure remains distinct from completed search insufficiency", async () => {
  const pipeline = new KnowledgeAcquisitionTruthPipeline(new RelevantKnowledgeAcquisitionProvider(
    new FixedProvider({
      sources: [],
      claims: [],
      completion: { status: "FAILED", reason: "PROVIDER_FAILURE" },
    }),
    investigator(),
  ));
  const execution = await pipeline.execute("knowledge-source-failure", baseRequest);
  const knowledge = buildKnowledgeOutcome(run("knowledge-source-failure"), execution.bundle);

  assert.equal(knowledge.availability, "SOURCE_UNAVAILABLE");
  assert.deepEqual(knowledge.findings, []);
  const message = await renderKnowledgeResponseForRun(knowledge, run("knowledge-source-failure"));
  assert.match(message, /couldn't reach the external information source/iu);
  assert.doesNotMatch(message, /couldn't establish enough relevant evidence/iu);
});

test("unexpected raw provider exceptions propagate instead of becoming epistemic insufficiency", async () => {
  const pipeline = new KnowledgeAcquisitionTruthPipeline({
    kind: "unexpected-provider-failure",
    async acquire() {
      throw new Error("injected unexpected provider programming failure");
    },
  });

  await assert.rejects(
    pipeline.execute("knowledge-unexpected-provider-failure", baseRequest),
    /injected unexpected provider programming failure/iu,
  );
});

test("semantic responsiveness failure remains investigation-unavailable rather than no-responsive", async () => {
  const pipeline = new KnowledgeAcquisitionTruthPipeline(new RelevantKnowledgeAcquisitionProvider(
    new FixedProvider(answerableResult()),
    investigator({ selectionError: new Error("injected responsiveness runtime failure") }),
  ));
  const execution = await pipeline.execute("knowledge-responsiveness-failure", baseRequest);
  const knowledge = buildKnowledgeOutcome(run("knowledge-responsiveness-failure"), execution.bundle);

  assert.equal(knowledge.availability, "INVESTIGATION_UNAVAILABLE");
  assert.deepEqual(knowledge.findings, []);
  assert.doesNotMatch(JSON.stringify(execution.bundle), /injected responsiveness runtime failure/iu);
});

test("complete acquisition with zero candidates remains honest completed-search insufficiency", async () => {
  const pipeline = new KnowledgeAcquisitionTruthPipeline(new RelevantKnowledgeAcquisitionProvider(
    new FixedProvider({ sources: [], claims: [], completion: { status: "COMPLETE" } }),
    investigator(),
  ));
  const execution = await pipeline.execute("knowledge-no-candidates", baseRequest);
  const knowledge = buildKnowledgeOutcome(run("knowledge-no-candidates"), execution.bundle);

  assert.equal(knowledge.availability, "NO_CANDIDATES");
  assert.deepEqual(knowledge.findings, []);
  const message = await renderKnowledgeResponseForRun(knowledge, run("knowledge-no-candidates"));
  assert.match(message, /able to check the available external source/iu);
  assert.doesNotMatch(message, /temporar|unavailable|couldn't complete/iu);
});

test("acquired candidates rejected by semantic responsiveness remain distinct from source failure", async () => {
  const pipeline = new KnowledgeAcquisitionTruthPipeline(new RelevantKnowledgeAcquisitionProvider(
    new FixedProvider(answerableResult()),
    investigator({ select: "none" }),
  ));
  const execution = await pipeline.execute("knowledge-no-responsive", baseRequest);
  const knowledge = buildKnowledgeOutcome(run("knowledge-no-responsive"), execution.bundle);

  assert.equal(knowledge.availability, "NO_RESPONSIVE_MATERIAL");
  assert.deepEqual(knowledge.findings, []);
  const message = await renderKnowledgeResponseForRun(knowledge, run("knowledge-no-responsive"));
  assert.match(message, /able to check the available external source/iu);
  assert.match(message, /did not actually address/iu);
  assert.doesNotMatch(message, /couldn't reach/iu);
});

test("partial acquisition preserves trustworthy partial evidence and explicit operational uncertainty", async () => {
  const pipeline = new KnowledgeAcquisitionTruthPipeline(new RelevantKnowledgeAcquisitionProvider(
    new FixedProvider(answerableResult({ status: "PARTIAL", reason: "RATE_LIMITED" })),
    investigator(),
  ));
  const execution = await pipeline.execute("knowledge-partial", baseRequest);
  const knowledge = buildKnowledgeOutcome(run("knowledge-partial"), execution.bundle);

  assert.equal(knowledge.availability, "PARTIAL");
  assert.equal(knowledge.findings.length, 1);
  assert.equal(knowledge.provenance.length, 1);
  assert.ok(knowledge.uncertainties.some((item) => /limited further requests/iu.test(item)));
});

test("responsive acquired evidence rejected by V36 remains evidence insufficiency, not provider failure", async () => {
  const rejectAll: KnowledgeEvidenceAdmissionPolicy = {
    disposition() {
      return {
        verification: "REJECTED",
        admitted: false,
        rejectionReason: "Held-out evidence does not satisfy this qualification policy.",
        provenanceComponentKey: null,
        provenanceConfidence: "UNKNOWN",
        authoritativePrimary: false,
        establishedProofKinds: [],
      };
    },
  };
  const pipeline = new KnowledgeAcquisitionTruthPipeline(
    new FixedProvider(answerableResult()),
    rejectAll,
  );
  const execution = await pipeline.execute("knowledge-v36-rejected", baseRequest);
  const knowledge = buildKnowledgeOutcome(run("knowledge-v36-rejected"), execution.bundle);

  assert.equal(knowledge.availability, "EVIDENCE_INSUFFICIENT");
  assert.equal(knowledge.findings.length, 1);
  assert.equal(knowledge.provenance.length, 1);
  assert.equal(knowledge.evidence?.[0]?.admitted, false);
  const message = await renderKnowledgeResponseForRun(knowledge, run("knowledge-v36-rejected"));
  assert.match(message, /Qualified evidence did not establish/iu);
  assert.doesNotMatch(message, /external investigation|external information source/iu);
});

test("normal answerable external Knowledge establishes governed source-bound findings and provenance", async () => {
  const pipeline = new KnowledgeAcquisitionTruthPipeline(new FixedProvider(answerableResult()));
  const execution = await pipeline.execute("knowledge-established", baseRequest);
  const knowledge = buildKnowledgeOutcome(run("knowledge-established"), execution.bundle);

  assert.equal(knowledge.availability, "GOVERNED_FINDINGS");
  assert.equal(knowledge.findings.length, 1);
  assert.equal(knowledge.provenance.length, 1);
  assert.equal(knowledge.evidence?.[0]?.admitted, true);
  assert.equal(knowledge.findings[0]?.evidenceIds[0], knowledge.evidence?.[0]?.evidenceId);
  assert.equal(knowledge.provenance[0]?.canonicalUri, "https://example.test/lunar-eclipse");
});

test("fresh general-reference material is presented only as a source report, not current authoritative fact", async () => {
  const currentRequest: LatticeRunRequest = {
    ...baseRequest,
    objective: "What are the current public opening hours for the observatory?",
  };
  const report = "A general reference page reports that the observatory opens to the public at 7 p.m.";
  const currentResult: KnowledgeAcquisitionResult = {
    sources: [{
      sourceId: "source-current-reference",
      canonicalUri: "https://example.test/observatory-reference",
      title: "Observatory reference",
      publisher: "Example Reference",
      retrievedAt: "2026-09-20T00:00:00.000Z",
      publishedAt: null,
      contentType: "text/plain",
      content: report,
      metadata: { evidentiarySuitability: "GENERAL_REFERENCE" },
    }],
    claims: [{
      claimId: "claim-current-reference",
      text: report,
      claimType: "CURRENT_STATE",
      evidence: [{
        sourceId: "source-current-reference",
        relation: "SUPPORTS",
        excerpt: report,
      }],
    }],
    completion: { status: "COMPLETE" },
  };
  const pipeline = new KnowledgeAcquisitionTruthPipeline(new FixedProvider(currentResult));
  const execution = await pipeline.execute("knowledge-current-reference", currentRequest);
  const knowledge = buildKnowledgeOutcome(run("knowledge-current-reference", currentRequest), execution.bundle);
  const message = await renderKnowledgeResponseForRun(
    knowledge,
    run("knowledge-current-reference", currentRequest),
  );

  assert.equal(knowledge.provenance[0]?.evidentiarySuitability, "GENERAL_REFERENCE");
  assert.match(message, /retrieved source material reports/iu);
  assert.match(message, /does not by itself independently verify the broader real-world claim/iu);
  assert.doesNotMatch(message, /^The observatory opens to the public at 7 p\.m\./iu);
});
