import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { RelevantKnowledgeAcquisitionProvider } from "../dist/src/knowledge/investigation.js";
import {
  AlphaDecisionKnowledgeAcquisitionProvider,
} from "../dist/src/knowledge/npm-decision-acquisition.js";
import { WikimediaKnowledgeAcquisitionProvider } from "../dist/src/knowledge/wikimedia-acquisition.js";
import {
  GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
  GroqKnowledgeSimplifierModelProvider,
  GroqKnowledgeSimplifierModelRuntime,
} from "../dist/src/model/groq-knowledge-simplifier.js";
import { stableModelJson } from "../dist/src/model/canonical.js";
import { createRuntimeApp } from "../dist/src/runtime-app.js";
import { resolveRuntimeConfig } from "../dist/src/runtime-config.js";
import { createConfiguredSolandraCognition } from "../dist/src/solandra/cognition-composition.js";
import { ModelSolandraKnowledgeInvestigator } from "../dist/src/solandra/knowledge-investigator.js";
import { KnowledgeAcquisitionTruthPipeline } from "../dist/src/truth/knowledge-acquisition-pipeline.js";
import { AlphaDecisionKnowledgeEvidenceAdmissionPolicy } from "../dist/src/truth/npm-decision-admission.js";

const expectedSha = process.env.EXPECTED_PRODUCT_SHA?.trim();
const expectedTree = process.env.EXPECTED_PRODUCT_TREE?.trim();
assert.ok(expectedSha && expectedTree, "Exact Product SHA/tree are required.");
assert.ok(process.env.GROQ_API_KEY?.trim(), "GROQ_API_KEY is unavailable.");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
assert.equal(git("rev-parse", "HEAD"), expectedSha);
assert.equal(git("rev-parse", "HEAD^{tree}"), expectedTree);

const config = resolveRuntimeConfig({
  ...process.env,
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-live",
  LATTICE_AUTHENTICATION_MODE: "development-fixture",
  LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "issue91-semantic-capacity-live",
  LATTICE_SOLANDRA_COGNITION_ROUTE: "groq-gpt-oss-120b",
});
const solandra = createConfiguredSolandraCognition(config);
assert.ok(solandra, "Configured Solandra composition is required.");

const artifactDir = resolve(process.env.VALIDATION_ARTIFACT_DIR ?? "../artifacts/issue91-semantic-capacity-live");
mkdirSync(artifactDir, { recursive: true });
const evidence = {
  product: { sha: expectedSha, tree: expectedTree },
  question: "What evidence convinced scientists that continents move, and when did plate tectonics become widely accepted?",
  cognition: [],
  acquisition: [],
  modelCalls: [],
  truthHandoff: [],
  v36: { invoked: false, dispositionCount: 0, dispositions: [] },
  productResult: null,
};
function writeEvidence() {
  writeFileSync(resolve(artifactDir, "evidence.json"), JSON.stringify(evidence, null, 2));
}

function boundedError(error) {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.slice(0, 500);
}

function projection(proposal) {
  return {
    objectiveRelation: proposal.objectiveRelation,
    requestedHelp: proposal.requestedHelp,
    knowledgeNeeds: proposal.knowledgeNeeds,
    materialAmbiguity: proposal.materialAmbiguity,
  };
}

const observedCognition = {
  async interpret(input) {
    const result = await solandra.cognition.interpret(input);
    const observation = {
      mode: result.mode === "CONVERSATION" ? "CONVERSATION" : "GOVERNED",
      actualProvider: result.invocationProvenance.actualProvider ?? null,
      actualModel: result.invocationProvenance.actualModel ?? null,
      routeProvenance: result.invocationProvenance.routeProvenance ?? null,
      ...(result.mode === "CONVERSATION" ? {} : { proposal: projection(result.proposal) }),
    };
    evidence.cognition.push(observation);
    writeEvidence();
    console.log(`ISSUE91_LIVE_COGNITION=${JSON.stringify(observation)}`);
    return result;
  },
};

const rawWikimedia = new WikimediaKnowledgeAcquisitionProvider();
const recordingRaw = {
  kind: `live-recording:${rawWikimedia.kind}`,
  async acquire(input) {
    try {
      const result = await rawWikimedia.acquire(input);
      const record = {
        completion: result.completion ?? { status: "COMPLETE" },
        sourceCount: result.sources.length,
        claimCount: result.claims.length,
        queries: [...(input.investigationQueries ?? [])],
        sources: result.sources.map((item) => ({
          sourceId: item.sourceId,
          title: item.title,
          canonicalUri: item.canonicalUri,
        })),
      };
      evidence.acquisition.push(record);
      writeEvidence();
      console.log(`ISSUE91_LIVE_ACQUISITION=${JSON.stringify(record)}`);
      return result;
    } catch (error) {
      const record = { error: boundedError(error) };
      evidence.acquisition.push(record);
      writeEvidence();
      console.log(`ISSUE91_LIVE_ACQUISITION=${JSON.stringify(record)}`);
      throw error;
    }
  },
};

function userMessage(request) {
  return request.messages.find((message) => message.role === "user")?.content ?? "";
}
function ids(content, label) {
  const pattern = new RegExp(`^${label}: ([^\\n]+)$`, "gmu");
  return [...content.matchAll(pattern)].map((match) => match[1]);
}

const liveGroq = new GroqKnowledgeSimplifierModelProvider({ apiKey: process.env.GROQ_API_KEY });
const recordingModelProvider = {
  kind: `live-recording:${liveGroq.kind}`,
  async generate(request, context) {
    const system = request.messages.find((message) => message.role === "system")?.content ?? "";
    const purpose = system.includes("semantic responsiveness boundary")
      ? "RESPONSIVENESS"
      : system.includes("Knowledge investigation cognition")
        ? "INVESTIGATION_PLANNING"
        : "OTHER";
    const user = userMessage(request);
    const record = {
      purpose,
      requestChars: stableModelJson(request).length,
      requestBytes: Buffer.byteLength(stableModelJson(request), "utf8"),
      messageChars: request.messages.map((message) => message.content.length),
      claimIds: purpose === "RESPONSIVENESS" ? ids(user, "Claim ID") : [],
      sourceIds: purpose === "RESPONSIVENESS" ? ids(user, "Source ID") : [],
      outcome: "PENDING",
      actualProvider: null,
      actualModel: null,
      error: null,
    };
    evidence.modelCalls.push(record);
    writeEvidence();
    try {
      const result = await liveGroq.generate(request, context);
      record.outcome = "SUCCESS";
      record.actualProvider = result.route?.actualProvider ?? null;
      record.actualModel = result.route?.actualModel ?? null;
      writeEvidence();
      console.log(`ISSUE91_LIVE_MODEL_CALL=${JSON.stringify(record)}`);
      return result;
    } catch (error) {
      record.outcome = "FAILED";
      record.error = boundedError(error);
      writeEvidence();
      console.log(`ISSUE91_LIVE_MODEL_CALL=${JSON.stringify(record)}`);
      throw error;
    }
  },
};
const investigationRuntime = new GroqKnowledgeSimplifierModelRuntime(recordingModelProvider);
const investigator = new ModelSolandraKnowledgeInvestigator(
  investigationRuntime,
  GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
);
const responsive = new RelevantKnowledgeAcquisitionProvider(recordingRaw, investigator);
const alphaAcquisition = new AlphaDecisionKnowledgeAcquisitionProvider(responsive);
const recordingSemanticHandoff = {
  kind: `truth-handoff-recording:${alphaAcquisition.kind}`,
  async acquire(input) {
    const result = await alphaAcquisition.acquire(input);
    const record = {
      completion: result.completion ?? { status: "COMPLETE" },
      sourceCount: result.sources.length,
      claimCount: result.claims.length,
      claimIds: result.claims.map((item) => item.claimId),
      sourceIds: result.sources.map((item) => item.sourceId),
    };
    evidence.truthHandoff.push(record);
    writeEvidence();
    console.log(`ISSUE91_LIVE_TRUTH_HANDOFF=${JSON.stringify(record)}`);
    return result;
  },
};

const canonicalAdmission = new AlphaDecisionKnowledgeEvidenceAdmissionPolicy();
const recordingAdmission = {
  disposition(input) {
    evidence.v36.invoked = true;
    evidence.v36.dispositionCount += 1;
    const result = canonicalAdmission.disposition(input);
    evidence.v36.dispositions.push({
      claimId: input.claim.id,
      sourceId: input.source.id,
      verification: result.verification,
      admitted: result.admitted,
      rejectionReason: result.rejectionReason,
    });
    writeEvidence();
    return result;
  },
};
const truthPipeline = new KnowledgeAcquisitionTruthPipeline(recordingSemanticHandoff, recordingAdmission);

const app = await createRuntimeApp(config, {
  memoryDispatchDelayMs: 1,
  truthPipeline,
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
async function waitForRun(runId) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const run = await request({ method: "GET", url: `/api/v1/runs/${runId}` });
    if (run.status === "FAILED" || run.status === "CANCELLED") throw new Error(`Run ${runId} reached ${run.status}`);
    if (run.status === "COMPLETED") {
      return {
        run,
        result: await request({ method: "GET", url: `/api/v1/runs/${runId}/outcome` }),
      };
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`Run ${runId} timed out`);
}

try {
  const conversation = await request({ method: "POST", url: "/api/v1/conversations" });
  const conversationId = conversation.conversation.id;
  const accepted = await request({
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/turns`,
    payload: { turnId: randomUUID(), message: evidence.question },
  });
  assert.equal(accepted.status, "RUN_ACCEPTED", `Live canary did not enter governed Knowledge: ${JSON.stringify(accepted)}`);
  assert.ok(accepted.runId);
  const completed = await waitForRun(accepted.runId);
  const continuity = await request({ method: "GET", url: `/api/v1/conversations/${conversationId}/continuity` });
  const knowledge = Array.isArray(continuity.knowledge)
    ? continuity.knowledge.find((item) => item.runId === accepted.runId) ?? continuity.knowledge.at(-1)
    : null;
  const responsiveness = evidence.modelCalls.filter((item) => item.purpose === "RESPONSIVENESS");
  const outcome = completed.result.outcome;
  evidence.productResult = {
    status: accepted.status,
    runId: accepted.runId,
    runStatus: completed.run.status,
    knowledgeId: knowledge?.knowledgeId ?? null,
    findings: outcome?.findings ?? [],
    provenance: outcome?.provenance ?? [],
    uncertainty: outcome?.uncertainties ?? [],
    assistantMessage: completed.result.presentation?.assistantMessage ?? null,
    truthBundle: {
      sourceCount: completed.result.truth?.sources?.length ?? null,
      claimCount: completed.result.truth?.claims?.length ?? null,
      evidenceCount: completed.result.truth?.claimEvidence?.length ?? null,
    },
    responsivenessRequestCount: responsiveness.length,
  };
  writeEvidence();
  console.log(`ISSUE91_LIVE_PRODUCT_RESULT=${JSON.stringify(evidence.productResult)}`);
  console.log(`ISSUE91_LIVE_V36=${JSON.stringify(evidence.v36)}`);
  assert.equal(evidence.cognition.at(-1)?.mode, "GOVERNED");
  assert.equal(evidence.cognition.at(-1)?.proposal?.requestedHelp, "KNOWLEDGE");
  assert.ok(evidence.acquisition.length > 0, "Wikimedia acquisition must be observed.");
  assert.ok(responsiveness.length > 0, "Solandra responsiveness must execute.");
  assert.ok(responsiveness.every((item) => item.outcome === "SUCCESS"), "Every responsiveness model request must complete successfully.");
  assert.ok(responsiveness.every((item) => item.messageChars.every((count) => count <= 64 * 1024)));
  assert.ok(evidence.truthHandoff.length > 0, "Exact semantic selections must reach the truth handoff.");
} finally {
  writeEvidence();
  await app.close();
}
