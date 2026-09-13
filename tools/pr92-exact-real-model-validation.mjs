import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { WikimediaKnowledgeAcquisitionProvider } from "../dist/src/knowledge/wikimedia-acquisition.js";
import { createRuntimeApp } from "../dist/src/runtime-app.js";
import { resolveRuntimeConfig } from "../dist/src/runtime-config.js";
import { createConfiguredSolandraCognition } from "../dist/src/solandra/cognition-composition.js";

const expectedSha = "e589b343e8ce6b517490fda59008cd456a0624c0";
const expectedTree = "24e64fb796a0f608743cda7b65edd9385d480cb3";
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
assert.equal(git("rev-parse", "HEAD"), expectedSha);
assert.equal(git("rev-parse", "HEAD^{tree}"), expectedTree);

const config = resolveRuntimeConfig();
assert.equal(config.truthMode, "v36-live");
assert.equal(config.solandraCognitionRoute, "groq-gpt-oss-120b");
const solandra = createConfiguredSolandraCognition(config);
assert.ok(solandra, "Configured Solandra composition is required.");

const acquisitions = [];
const cognition = [];
const evidence = {
  product: { sha: expectedSha, tree: expectedTree },
  reusedOrdinaryEvidence: { workflowRunId: 34769624090, acceptedCompletedTurns: 6, repeated: false },
  route: { configured: config.solandraCognitionRoute, truthMode: config.truthMode, composedModel: solandra.model },
  cognition,
  knowledge: null,
  historicalFollowUp: null,
};
const artifactDir = resolve("../artifacts/pr92-real-model/journey");
mkdirSync(artifactDir, { recursive: true });
const persist = () => writeFileSync(resolve(artifactDir, "evidence.json"), JSON.stringify(evidence, null, 2));

const observedCognition = {
  async interpret(input) {
    const result = await solandra.cognition.interpret(input);
    const mode = result.mode === "CONVERSATION" ? "CONVERSATION" : "GOVERNED";
    const observation = {
      sequence: cognition.length + 1,
      mode,
      actualProvider: result.invocationProvenance.actualProvider ?? null,
      actualModel: result.invocationProvenance.actualModel ?? null,
      routeProvenance: result.invocationProvenance.routeProvenance ?? null,
      ...(mode === "GOVERNED" ? {
        projection: {
          objectiveRelation: result.proposal.objectiveRelation,
          proposedObjective: result.proposal.proposedObjective,
          requestedHelp: result.proposal.requestedHelp,
          relevantContext: result.proposal.relevantContext,
          entities: result.proposal.entities,
          referents: result.proposal.referents,
          constraints: result.proposal.constraints,
          preferences: result.proposal.preferences,
          knowledgeNeeds: result.proposal.knowledgeNeeds,
          materialAmbiguity: result.proposal.materialAmbiguity,
          referencedKnowledgeId: result.proposal.referencedKnowledgeId,
        },
      } : {}),
    };
    cognition.push(observation);
    persist();
    console.log(`PR92_COGNITION_OBSERVATION=${JSON.stringify(observation)}`);
    return result;
  },
};

const provider = new WikimediaKnowledgeAcquisitionProvider();
const recordingProvider = {
  kind: `pr92-validation:${provider.kind}`,
  async acquire(input) {
    const result = await provider.acquire(input);
    acquisitions.push({
      objective: input.objective,
      queries: [...(input.investigationQueries ?? [])],
      sources: result.sources.map(({ sourceId, title, canonicalUri }) => ({ sourceId, title, canonicalUri })),
    });
    persist();
    return result;
  },
};

const app = await createRuntimeApp(config, {
  memoryDispatchDelayMs: 1,
  knowledgeAcquisitionProvider: recordingProvider,
  solandraCognition: observedCognition,
  solandraAdvisory: solandra.advisory,
  solandraActionPreparer: solandra.actionPreparer,
  solandraKnowledgePresenter: solandra.knowledgePresenter,
});

async function request(options) {
  const response = await app.inject(options);
  assert.ok(response.statusCode >= 200 && response.statusCode < 300, response.body);
  return response.json();
}
async function createConversation() {
  return (await request({ method: "POST", url: "/api/v1/conversations" })).conversation.id;
}
async function continuity(conversationId) {
  return request({ method: "GET", url: `/api/v1/conversations/${conversationId}/continuity` });
}
async function submit(conversationId, message) {
  return request({ method: "POST", url: `/api/v1/conversations/${conversationId}/turns`, payload: { turnId: randomUUID(), message } });
}
async function completedOutcome(runId) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const run = await request({ method: "GET", url: `/api/v1/runs/${runId}` });
    if (run.status === "FAILED" || run.status === "CANCELLED") throw new Error(`Run ${runId} reached ${run.status}`);
    if (run.status === "COMPLETED") return (await request({ method: "GET", url: `/api/v1/runs/${runId}/outcome` })).outcome;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`Run ${runId} timed out`);
}

try {
  persist();
  const conversationId = await createConversation();
  const knowledgeRequest = "I heard that Venus takes longer to rotate once than to orbit the Sun. Please verify that with trustworthy external sources and summarize what the evidence supports.";
  const before = await continuity(conversationId);
  const accepted = await submit(conversationId, knowledgeRequest);
  evidence.knowledge = {
    userRequest: knowledgeRequest,
    cognition: cognition[0] ?? null,
    publicCognition: accepted.interpretation ?? null,
    status: accepted.status,
    runId: accepted.runId ?? null,
  };
  persist();
  assert.equal(cognition[0]?.mode, "GOVERNED");
  assert.equal(accepted.status, "RUN_ACCEPTED");
  assert.ok(accepted.runId);

  const outcome = await completedOutcome(accepted.runId);
  const after = await continuity(conversationId);
  const knowledgeRecord = after.knowledge?.at(-1) ?? null;
  Object.assign(evidence.knowledge, {
    findings: outcome.findings,
    uncertainties: outcome.uncertainties,
    provenance: outcome.provenance,
    evidence: outcome.evidence ?? [],
    acquisition: acquisitions[0] ?? null,
    knowledgeId: knowledgeRecord?.knowledgeId ?? null,
    stateDelta: {
      runs: (after.runs?.length ?? 0) - (before.runs?.length ?? 0),
      knowledge: (after.knowledge?.length ?? 0) - (before.knowledge?.length ?? 0),
    },
  });
  persist();
  assert.equal((after.runs?.length ?? 0) - (before.runs?.length ?? 0), 1);
  assert.equal((after.knowledge?.length ?? 0) - (before.knowledge?.length ?? 0), 1);
  assert.equal(acquisitions.length, 1);
  assert.ok(knowledgeRecord?.knowledgeId);
  if (outcome.findings.length === 0) {
    assert.deepEqual(outcome.provenance, []);
    assert.deepEqual(outcome.evidence ?? [], []);
    assert.ok(outcome.uncertainties.some((item) => item.includes("sufficiently relevant")));
  }

  const followRequest = "Which source from that check most directly supports the rotation-versus-orbit comparison? Keep the answer brief.";
  const beforeFollow = await continuity(conversationId);
  const follow = await submit(conversationId, followRequest);
  const afterFollow = await continuity(conversationId);
  evidence.historicalFollowUp = {
    userRequest: followRequest,
    cognition: cognition[1] ?? null,
    publicCognition: follow.interpretation ?? null,
    status: follow.status,
    assistantMessage: follow.presentation?.assistantMessage ?? null,
    knowledgeReference: follow.knowledgeReference ?? null,
    establishedKnowledgeId: knowledgeRecord.knowledgeId,
    priorProvenance: outcome.provenance,
    stateDelta: {
      runs: (afterFollow.runs?.length ?? 0) - (beforeFollow.runs?.length ?? 0),
      knowledge: (afterFollow.knowledge?.length ?? 0) - (beforeFollow.knowledge?.length ?? 0),
    },
  };
  persist();
  assert.equal(cognition[1]?.mode, "GOVERNED");
  assert.equal(follow.status, "REFERENCE_RESOLVED");
  assert.equal((afterFollow.runs?.length ?? 0) - (beforeFollow.runs?.length ?? 0), 0);
  assert.equal(follow.knowledgeReference?.knowledgeId, knowledgeRecord.knowledgeId);
  assert.ok(follow.presentation?.assistantMessage?.trim());

  assert.equal(git("rev-parse", "HEAD"), expectedSha);
  assert.equal(git("rev-parse", "HEAD^{tree}"), expectedTree);
  persist();
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  console.log("PR92_KNOWLEDGE_ONLY_REAL_MODEL_VALIDATION=PASS");
} finally {
  await app.close();
}
