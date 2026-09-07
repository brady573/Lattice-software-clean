import assert from "node:assert/strict";
import test from "node:test";
import { ALPHA_NPM_RUNTIME_DEPENDENCY_CRITERION_ID } from "../src/decision/alpha-decision-capability.js";
import { alphaDecisionCriterionCatalog } from "../src/decision/alpha-decision-capability.js";
import { consultationRunRequestSchema } from "../src/domain.js";
import type { KnowledgeAcquisitionProvider } from "../src/knowledge/acquisition.js";
import {
  AlphaDecisionKnowledgeAcquisitionProvider,
  NpmDecisionKnowledgeAcquisitionProvider,
} from "../src/knowledge/npm-decision-acquisition.js";
import { buildDecisionInputSnapshot } from "../src/decision/decision-input-snapshot.js";
import { GovernedKnowledgeDecisionEvidenceProvider } from "../src/truth/governed-decision-evidence.js";
import { KnowledgeAcquisitionTruthPipeline } from "../src/truth/knowledge-acquisition-pipeline.js";
import { AlphaDecisionKnowledgeEvidenceAdmissionPolicy } from "../src/truth/npm-decision-admission.js";

const fixedNow = "2026-09-06T23:59:00.000Z";
const metadata = new Map<string, { version: string; dependencies: Record<string, string> }>([
  ["express", { version: "5.1.0", dependencies: { alpha: "1", beta: "1", gamma: "1" } }],
  ["fastify", { version: "5.6.0", dependencies: { alpha: "1" } }],
]);

function npmFetch(): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const packageName = decodeURIComponent(url.pathname.split("/").filter(Boolean)[0] ?? "").toLocaleLowerCase("en-US");
    const value = metadata.get(packageName);
    if (!value) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify({
      name: packageName,
      version: value.version,
      dependencies: value.dependencies,
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

const emptyFallback: KnowledgeAcquisitionProvider = {
  kind: "a3-v36-test-fallback",
  async acquire() {
    return { sources: [], claims: [] };
  },
};

test("A3 npm facts cross V36 before governed decision evidence projection", async () => {
  const npm = new NpmDecisionKnowledgeAcquisitionProvider({
    fetchImpl: npmFetch(),
    clock: () => new Date(fixedNow),
  });
  const pipeline = new KnowledgeAcquisitionTruthPipeline(
    new AlphaDecisionKnowledgeAcquisitionProvider(emptyFallback, npm),
    new AlphaDecisionKnowledgeEvidenceAdmissionPolicy(),
  );
  const objective = "Help me choose between npm packages express and fastify. Fewer runtime dependencies are my top priority.";
  const decisionInput = buildDecisionInputSnapshot({
    intentScopeId: "consultation:a3-v36",
    intentVersionId: "intent-version-a3-v36",
    objective,
    hardRequirements: [],
    priorities: [{ criterionId: ALPHA_NPM_RUNTIME_DEPENDENCY_CRITERION_ID, tier: "MATTERS_MOST" }],
    tolerances: [],
  }, alphaDecisionCriterionCatalog);
  const request = consultationRunRequestSchema.parse({
    kind: "consultation",
    objective,
    context: [],
    decisionNeed: "QUALIFIED",
    resourceNeed: "NONE",
    sourceMessageId: "source-message-a3-v36",
    sourceMessageDigest: "a".repeat(64),
    intentVersion: 1,
    intentScopeId: decisionInput.intentScopeId,
    intentVersionId: decisionInput.intentVersionId,
    decisionInput,
  });

  const execution = await pipeline.execute("run-a3-v36", request);
  const assessments = execution.bundle.assessments.map((item) => ({
    claimId: item.claimId,
    verdict: item.verdict,
    admittedEvidenceIds: item.admittedEvidenceIds,
    unresolvedObligationIds: item.unresolvedObligationIds,
  }));
  assert.equal(execution.bundle.assessments.length, 2, JSON.stringify(assessments));
  assert.ok(execution.bundle.assessments.every((item) => item.verdict === "TRUE"), JSON.stringify(assessments));
  assert.ok(execution.bundle.claimEvidence.every((item) => item.admitted && item.verification === "VERIFIED"), JSON.stringify(execution.bundle.claimEvidence));

  const projected = await new GovernedKnowledgeDecisionEvidenceProvider().projectDecisionEvidence(
    execution.snapshot,
    request,
  );
  assert.deepEqual(projected.candidates.map((item) => item.id), ["express", "fastify"]);
  assert.deepEqual(projected.evidence.map((item) => [item.candidateId, item.value]), [
    ["express", 3],
    ["fastify", 1],
  ]);
});
