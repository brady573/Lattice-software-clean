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
  investigationFailureCause,
  type KnowledgeInvestigator,
} from "../src/knowledge/investigation.js";
import { ModelProviderError } from "../src/model/errors.js";
import { buildKnowledgeOutcome } from "../src/outcome.js";
import { renderKnowledgeResponseForRun } from "../src/presentation/solandra/knowledge-response.js";
import { KnowledgeAcquisitionTruthPipeline } from "../src/truth/knowledge-acquisition-pipeline.js";

const OBJECTIVE = "Explain how a lunar eclipse happens held-out diagnostic probe.";
const CONTEXT = ["held-out diagnostic context"];
const QUERY = "held-out external explanation need";

const baseRequest: LatticeRunRequest = {
  kind: "consultation",
  objective: OBJECTIVE,
  context: [...CONTEXT],
  investigationQueries: [QUERY],
  advisoryRequested: false,
  decisionNeed: "NONE",
  resourceNeed: "NONE",
  sourceMessageId: "knowledge-diagnostic-message",
  sourceMessageDigest: "b".repeat(64),
  intentVersion: 1,
  intentScopeId: "knowledge-diagnostic-scope",
  intentVersionId: "knowledge-diagnostic-intent",
};

function run(id: string): LatticeRun {
  return {
    id,
    conversationId: "knowledge-diagnostic-conversation",
    status: "COMPLETED",
    version: 1,
    request: baseRequest,
    decision: null,
    explanation: null,
    truthAssessmentIds: [],
    events: [],
  };
}

const CLAIM_TEXT = "A lunar eclipse occurs when Earth passes between the Sun and the Moon.";

function answerableResult(): KnowledgeAcquisitionResult {
  return {
    sources: [{
      sourceId: "source-lunar",
      canonicalUri: "https://example.test/lunar-eclipse",
      title: "Lunar eclipse reference",
      publisher: "Example Reference",
      retrievedAt: "2026-09-20T00:00:00.000Z",
      publishedAt: null,
      contentType: "text/plain",
      content: CLAIM_TEXT,
      metadata: {},
    }],
    claims: [{
      claimId: "claim-lunar",
      text: CLAIM_TEXT,
      claimType: "INTERPRETIVE",
      evidence: [{ sourceId: "source-lunar", relation: "SUPPORTS", excerpt: CLAIM_TEXT }],
    }],
    completion: { status: "COMPLETE" },
  };
}

class FixedProvider implements KnowledgeAcquisitionProvider {
  readonly kind = "knowledge-diagnostic-fixed-provider";

  constructor(private readonly result: KnowledgeAcquisitionResult) {}

  async acquire(_request: KnowledgeAcquisitionRequest): Promise<KnowledgeAcquisitionResult> {
    return structuredClone(this.result);
  }
}

function stubInvestigator(options: {
  planError?: Error;
  emptyPlan?: boolean;
  selectionError?: Error;
  unknownClaim?: boolean;
} = {}): KnowledgeInvestigator {
  return {
    kind: "knowledge-diagnostic-investigator",
    async plan() {
      if (options.planError) throw options.planError;
      if (options.emptyPlan) return { retrievalQueries: ["   "] };
      return { retrievalQueries: ["lunar eclipse mechanism"] };
    },
    async selectResponsive(input) {
      if (options.selectionError) throw options.selectionError;
      if (options.unknownClaim) {
        return { selections: [{ claimId: "claim-unknown-held-out", sourceIds: ["source-lunar"] }] };
      }
      return {
        selections: input.claims.map((claim) => ({
          claimId: claim.claimId,
          sourceIds: claim.evidence.map((item) => item.sourceId),
        })),
      };
    },
  };
}

async function capturedDiagnostics(fn: () => Promise<unknown>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(args.map((item) => String(item)).join(" "));
  };
  try {
    await fn();
  } finally {
    console.error = original;
  }
  return lines.filter((line) => line.includes("KNOWLEDGE_INVESTIGATION_UNAVAILABLE"));
}

test("planning model timeout emits PLANNING with bounded failure metadata and no content", async () => {
  const pipeline = new KnowledgeAcquisitionTruthPipeline(new RelevantKnowledgeAcquisitionProvider(
    new FixedProvider(answerableResult()),
    stubInvestigator({
      planError: new ModelProviderError("timeout", "injected planning timeout", { retryable: true }),
    }),
  ));
  let execution: Awaited<ReturnType<typeof pipeline.execute>> | undefined;
  const lines = await capturedDiagnostics(async () => {
    execution = await pipeline.execute("knowledge-diagnostic-planning", baseRequest);
  });
  assert.ok(execution);
  assert.equal(lines.length, 1);
  assert.equal(
    lines[0],
    "KNOWLEDGE_INVESTIGATION_UNAVAILABLE runId=knowledge-diagnostic-planning phase=PLANNING code=timeout statusCode=- retryable=true",
  );
  for (const forbidden of [OBJECTIVE, CONTEXT[0], QUERY, CLAIM_TEXT, "injected planning timeout"]) {
    assert.ok(forbidden !== undefined && !lines[0]?.includes(forbidden as string));
  }
  const knowledge = buildKnowledgeOutcome(run("knowledge-diagnostic-planning"), execution.bundle);
  assert.equal(knowledge.availability, "INVESTIGATION_UNAVAILABLE");
  assert.deepEqual(knowledge.findings, []);
  const message = await renderKnowledgeResponseForRun(knowledge, run("knowledge-diagnostic-planning"));
  assert.match(message, /couldn't complete the external investigation/iu);
  assert.doesNotMatch(JSON.stringify(execution.bundle), /injected planning timeout/iu);
  assert.doesNotMatch(JSON.stringify(execution.bundle), /PLANNING/);
});

test("responsiveness rate limit emits RESPONSIVENESS with status metadata", async () => {
  const pipeline = new KnowledgeAcquisitionTruthPipeline(new RelevantKnowledgeAcquisitionProvider(
    new FixedProvider(answerableResult()),
    stubInvestigator({
      selectionError: new ModelProviderError("rate_limit", "injected responsiveness limit", {
        statusCode: 429,
        retryable: true,
      }),
    }),
  ));
  let execution: Awaited<ReturnType<typeof pipeline.execute>> | undefined;
  const lines = await capturedDiagnostics(async () => {
    execution = await pipeline.execute("knowledge-diagnostic-responsiveness", baseRequest);
  });
  assert.ok(execution);
  assert.equal(lines.length, 1);
  assert.equal(
    lines[0],
    "KNOWLEDGE_INVESTIGATION_UNAVAILABLE runId=knowledge-diagnostic-responsiveness phase=RESPONSIVENESS code=rate_limit statusCode=429 retryable=true",
  );
  const knowledge = buildKnowledgeOutcome(run("knowledge-diagnostic-responsiveness"), execution.bundle);
  assert.equal(knowledge.availability, "INVESTIGATION_UNAVAILABLE");
  assert.deepEqual(knowledge.findings, []);
});

test("empty investigation plan emits PLANNING_EMPTY without failure metadata", async () => {
  const pipeline = new KnowledgeAcquisitionTruthPipeline(new RelevantKnowledgeAcquisitionProvider(
    new FixedProvider(answerableResult()),
    stubInvestigator({ emptyPlan: true }),
  ));
  let execution: Awaited<ReturnType<typeof pipeline.execute>> | undefined;
  const lines = await capturedDiagnostics(async () => {
    execution = await pipeline.execute("knowledge-diagnostic-empty", baseRequest);
  });
  assert.ok(execution);
  assert.equal(lines.length, 1);
  assert.equal(
    lines[0],
    "KNOWLEDGE_INVESTIGATION_UNAVAILABLE runId=knowledge-diagnostic-empty phase=PLANNING_EMPTY code=- statusCode=- retryable=-",
  );
  const knowledge = buildKnowledgeOutcome(run("knowledge-diagnostic-empty"), execution.bundle);
  assert.equal(knowledge.availability, "INVESTIGATION_UNAVAILABLE");
});

test("structural selection failure emits SELECTION_VALIDATION without claim content", async () => {
  const pipeline = new KnowledgeAcquisitionTruthPipeline(new RelevantKnowledgeAcquisitionProvider(
    new FixedProvider(answerableResult()),
    stubInvestigator({ unknownClaim: true }),
  ));
  let execution: Awaited<ReturnType<typeof pipeline.execute>> | undefined;
  const lines = await capturedDiagnostics(async () => {
    execution = await pipeline.execute("knowledge-diagnostic-selection", baseRequest);
  });
  assert.ok(execution);
  assert.equal(lines.length, 1);
  assert.equal(
    lines[0],
    "KNOWLEDGE_INVESTIGATION_UNAVAILABLE runId=knowledge-diagnostic-selection phase=SELECTION_VALIDATION code=- statusCode=- retryable=-",
  );
  for (const forbidden of [OBJECTIVE, CLAIM_TEXT, "claim-unknown-held-out"]) {
    assert.ok(!lines[0]?.includes(forbidden));
  }
  const knowledge = buildKnowledgeOutcome(run("knowledge-diagnostic-selection"), execution.bundle);
  assert.equal(knowledge.availability, "INVESTIGATION_UNAVAILABLE");
  assert.deepEqual(knowledge.findings, []);
});

test("failure-cause extraction exposes only bounded model metadata", () => {
  assert.deepEqual(
    investigationFailureCause(new ModelProviderError("unavailable", "transport down", {
      statusCode: 503,
      retryable: true,
    })),
    { code: "unavailable", statusCode: 503, retryable: true },
  );
  assert.equal(investigationFailureCause(new Error("ordinary failure")), undefined);
  assert.equal(investigationFailureCause("not-an-error"), undefined);
});
