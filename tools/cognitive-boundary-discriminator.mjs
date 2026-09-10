import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { RelevantKnowledgeAcquisitionProvider } from "../dist/src/knowledge/investigation.js";
import { createRuntimeApp } from "../dist/src/runtime-app.js";
import { resolveRuntimeConfig } from "../dist/src/runtime-config.js";
import { createConfiguredSolandraCognition } from "../dist/src/solandra/cognition-composition.js";
import { createConfiguredSolandraKnowledgeInvestigator } from "../dist/src/solandra/knowledge-investigator.js";
import { KnowledgeAcquisitionTruthPipeline } from "../dist/src/truth/knowledge-acquisition-pipeline.js";

const inputs = [
  "I keep hearing that a room can feel colder near a closed window even when the thermostat hasn't changed. What could be going on?",
  "Why can a phone's battery percentage drop faster in cold weather?",
  "I'm trying to understand why bread dough sometimes springs back when I stretch it.",
];

const candidateTexts = [
  {
    id: "window-radiation",
    title: "Cold-window radiant comfort",
    text: "A person near a cold window can lose more radiant heat to the colder glass surface. That lower mean radiant temperature can make the area feel colder even when the room air temperature measured by the thermostat is unchanged.",
  },
  {
    id: "battery-cold",
    title: "Lithium-ion batteries in low temperatures",
    text: "Low temperature slows electrochemical reaction and ion transport in a lithium-ion battery and raises internal resistance. Under load, voltage can sag sooner, so a phone may report less available charge or shut down earlier even though some capacity returns after warming.",
  },
  {
    id: "dough-elasticity",
    title: "Gluten network elasticity",
    text: "Hydrated wheat proteins form a gluten network that is both extensible and elastic. If dough is stretched before the network has relaxed, elastic tension can pull it back toward its previous shape; resting the dough reduces that resistance to stretching.",
  },
  {
    id: "bird-navigation",
    title: "Bird navigation",
    text: "Migratory birds can use multiple orientation cues, including celestial information, landmarks, odors, and magnetic-field sensing.",
  },
  {
    id: "ocean-salinity",
    title: "Ocean salinity",
    text: "Ocean salinity varies with evaporation, precipitation, river input, ice formation, and circulation.",
  },
  {
    id: "tax-deadline",
    title: "Tax filing deadlines",
    text: "Tax filing deadlines are established by the relevant tax authority and can vary by jurisdiction and filing status.",
  },
];

const config = resolveRuntimeConfig({
  ...process.env,
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-live",
  LATTICE_SOLANDRA_COGNITION_ROUTE: "groq-gpt-oss-120b",
});
const solandra = createConfiguredSolandraCognition(config);
const realInvestigator = createConfiguredSolandraKnowledgeInvestigator(config);
assert.ok(solandra, "Configured real Solandra cognition is required.");
assert.ok(realInvestigator, "Configured real Solandra Knowledge investigator is required.");

const planning = [];
const responsiveness = [];
const investigator = {
  kind: `discriminator:${realInvestigator.kind}`,
  async plan(input) {
    const output = await realInvestigator.plan(input);
    planning.push({ input: structuredClone(input), output: structuredClone(output) });
    return output;
  },
  async selectResponsive(input) {
    const output = await realInvestigator.selectResponsive(input);
    responsiveness.push({
      input: {
        runId: input.runId,
        objective: input.objective,
        context: [...input.context],
        knowledgeNeeds: [...input.knowledgeNeeds],
        retrievalQueries: [...input.retrievalQueries],
        candidates: input.claims.map((claim) => ({
          claimId: claim.claimId,
          sourceIds: claim.evidence.map((item) => item.sourceId),
          text: claim.text,
        })),
      },
      output: structuredClone(output),
    });
    return output;
  },
};

const acquisitions = [];
const provider = {
  kind: "discriminator-candidate-information",
  async acquire(request) {
    const sources = candidateTexts.map((candidate) => ({
      sourceId: `source:${candidate.id}`,
      canonicalUri: `https://discriminator.invalid/${candidate.id}`,
      title: candidate.title,
      publisher: "Temporary discriminator fixture",
      retrievedAt: "2026-09-10T21:00:00.000Z",
      publishedAt: null,
      contentType: "text/plain",
      content: candidate.text,
      metadata: { evidentiarySuitability: "GENERAL_REFERENCE" },
    }));
    const claims = candidateTexts.map((candidate) => ({
      claimId: `claim:${candidate.id}`,
      text: candidate.text,
      claimType: "INTERPRETIVE",
      evidence: [{
        sourceId: `source:${candidate.id}`,
        relation: "SUPPORTS",
        excerpt: candidate.text,
      }],
    }));
    acquisitions.push({
      runId: request.runId,
      objective: request.objective,
      context: [...request.context],
      retrievalQueries: [...(request.investigationQueries ?? [])],
      sourceIds: sources.map((source) => source.sourceId),
      claimIds: claims.map((claim) => claim.claimId),
    });
    return { sources, claims };
  },
};

const truthPipeline = new KnowledgeAcquisitionTruthPipeline(
  new RelevantKnowledgeAcquisitionProvider(provider, investigator),
);
const app = await createRuntimeApp(config, {
  memoryDispatchDelayMs: 1,
  truthPipeline,
  solandraCognition: solandra.cognition,
  solandraKnowledgePresenter: solandra.knowledgePresenter,
});

async function waitForOutcome(runId) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const run = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}` });
    assert.equal(run.statusCode, 200, run.body);
    const status = run.json().status;
    if (status === "FAILED" || status === "CANCELLED") throw new Error(`Run ${runId} reached ${status}.`);
    if (status === "COMPLETED") {
      const outcome = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}/outcome` });
      assert.equal(outcome.statusCode, 200, outcome.body);
      return outcome.json();
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Run ${runId} did not complete within discriminator deadline.`);
}

const evidence = [];
try {
  for (const userInput of inputs) {
    const created = await app.inject({ method: "POST", url: "/api/v1/conversations" });
    assert.equal(created.statusCode, 201, created.body);
    const conversationId = created.json().conversation.id;
    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: randomUUID(), message: userInput },
    });
    assert.equal(accepted.statusCode, 202, accepted.body);
    const acceptedBody = accepted.json();
    assert.equal(acceptedBody.status, "RUN_ACCEPTED");
    assert.equal(acceptedBody.acceptedUnderstanding, userInput);
    assert.equal(acceptedBody.interpretation?.authority, "NON_AUTHORITATIVE_PROPOSAL");
    assert.ok(
      acceptedBody.interpretation?.requestedHelp === "KNOWLEDGE"
      || acceptedBody.interpretation?.requestedHelp === "FRESH_RESEARCH",
      `Expected governed Knowledge work for: ${userInput}`,
    );
    assert.equal(acceptedBody.interpretation?.materialAmbiguity, null);

    const outcomeBody = await waitForOutcome(acceptedBody.runId);
    const plan = planning.find((entry) => entry.input.runId === acceptedBody.runId);
    const acquisition = acquisitions.find((entry) => entry.runId === acceptedBody.runId);
    const responsive = responsiveness.find((entry) => entry.input.runId === acceptedBody.runId);
    assert.ok(plan, `Missing Solandra investigation plan for ${acceptedBody.runId}`);
    assert.ok(acquisition, `Missing acquisition for ${acceptedBody.runId}`);
    assert.ok(responsive, `Missing Solandra semantic responsiveness for ${acceptedBody.runId}`);
    assert.ok(plan.output.retrievalQueries.length > 0);
    assert.deepEqual(acquisition.retrievalQueries, plan.output.retrievalQueries);
    assert.ok(responsive.output.selections.length > 0, `Solandra selected no responsive material for: ${userInput}`);
    assert.ok(
      responsive.output.selections.length < responsive.input.candidates.length,
      `Solandra did not exclude any non-responsive candidates for: ${userInput}`,
    );

    const acquiredClaimIds = new Set(responsive.input.candidates.map((item) => item.claimId));
    for (const selection of responsive.output.selections) {
      assert.ok(acquiredClaimIds.has(selection.claimId), `Selected claim was not acquired: ${selection.claimId}`);
    }

    evidence.push({
      userInput,
      cognition: {
        objectiveRelation: acceptedBody.interpretation.objectiveRelation,
        requestedHelp: acceptedBody.interpretation.requestedHelp,
        knowledgeNeeds: acceptedBody.interpretation.knowledgeNeeds,
        materialAmbiguity: acceptedBody.interpretation.materialAmbiguity,
      },
      deterministicSemanticFallbackInvoked: false,
      investigation: {
        conceptualKnowledgeNeeds: plan.input.knowledgeNeeds,
        retrievalQueries: plan.output.retrievalQueries,
      },
      acquisition: {
        retrievalQueries: acquisition.retrievalQueries,
        sourceIds: acquisition.sourceIds,
        claimIds: acquisition.claimIds,
      },
      semanticResponsiveness: {
        selected: responsive.output.selections,
      },
      v36: {
        findings: outcomeBody.outcome.findings.map((finding) => ({
          claimId: finding.claimId,
          status: finding.status,
          confidence: finding.confidence,
          basis: finding.basis,
          text: finding.text,
        })),
        provenance: outcomeBody.outcome.provenance.map((source) => ({
          sourceId: source.sourceId,
          canonicalUri: source.canonicalUri,
          publisher: source.publisher,
        })),
        evidence: outcomeBody.outcome.evidence.map((item) => ({
          evidenceId: item.evidenceId,
          sourceId: item.sourceId,
          admitted: item.admitted,
          verification: item.verification,
        })),
        uncertainties: outcomeBody.outcome.uncertainties,
      },
      finalUserFacingBehavior: outcomeBody.presentation?.assistantMessage ?? null,
    });
  }

  process.stdout.write(`COGNITIVE_BOUNDARY_DISCRIMINATOR=PASS\n${JSON.stringify(evidence, null, 2)}\n`);
} finally {
  await app.close();
}
