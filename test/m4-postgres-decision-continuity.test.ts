import assert from "node:assert/strict";
import test from "node:test";
import type { ModelInvocationProvenance } from "../src/model/types.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import type { SolandraAdvisoryRuntime } from "../src/solandra/advisory.js";
import type { SolandraCognitiveRuntime, SolandraSemanticProposal } from "../src/solandra/cognition.js";

const databaseUrl = process.env.DATABASE_URL;
const P: ModelInvocationProvenance = { executionClass: "LOCAL_OFFLINE", routeMode: "PINNED", requestedProvider: "m4", requestedModel: "m4", actualProvider: "m4", actualModel: "m4", brokerIdentity: null, brokerVersion: null, upstreamRequestId: "m4", routeProvenance: "COMPLETE" };
function proposal(overrides: Partial<SolandraSemanticProposal> = {}): SolandraSemanticProposal { return { objectiveRelation: "CONTINUE", proposedObjective: null, requestedHelp: "DECISION", relevantContext: [], entities: [], referents: [], constraints: [], preferences: [], knowledgeNeeds: [], materialAmbiguity: null, referencedKnowledgeId: null, referencedRecommendationId: null, referencedOptionId: null, ...overrides }; }
class C implements SolandraCognitiveRuntime { async interpret(input: Parameters<SolandraCognitiveRuntime["interpret"]>[0]) { const r = input.governedRecommendations?.at(-1); if (/choose/iu.test(input.message)) return { proposal: proposal({ requestedHelp: "ACCEPT_CHOICE", referencedRecommendationId: r?.recommendationId ?? null, referencedOptionId: r?.options[1]?.optionId ?? null }), invocationProvenance: P }; return { proposal: proposal({ objectiveRelation: input.currentObjective ? "CONTINUE" : "NEW_OBJECTIVE", proposedObjective: input.currentObjective ? null : input.message }), invocationProvenance: P }; } }
const advisory: SolandraAdvisoryRuntime = { async advise() { return { result: { status: "RECOMMENDATION", recommendation: "Keep the lighter routine.", basis: [], rationale: ["Matches USER preference."], tradeoffs: [], assumptions: [], uncertainties: [], preservedUncertainties: [], alternatives: ["Use the more structured routine."] }, invocationProvenance: P }; } };

test("PostgreSQL persists run-free Recommendation and AcceptedChoice across restart", { skip: !databaseUrl }, async () => {
  const config = resolveRuntimeConfig({ DATABASE_URL: databaseUrl!, LATTICE_DEPLOYMENT_MODE: "development", LATTICE_TRUTH_MODE: "v36-offline", LATTICE_AUTO_MIGRATE: "true", LATTICE_AUTHENTICATION_MODE: "development-fixture", LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "m4-pg-user" } as NodeJS.ProcessEnv);
  let first = await createRuntimeApp(config, { solandraCognition: new C(), solandraAdvisory: advisory });
  let conversationId = "";
  let choiceId = "";
  try {
    const created = await first.inject({ method: "POST", url: "/api/v1/conversations" }); conversationId = created.json().conversation.id;
    const rec = await first.inject({ method: "POST", url: `/api/v1/conversations/${conversationId}/turns`, payload: { turnId: "pg-1", message: "Help me pick a low-upkeep routine." } });
    assert.equal(rec.statusCode, 200, rec.body);
    const chosen = await first.inject({ method: "POST", url: `/api/v1/conversations/${conversationId}/turns`, payload: { turnId: "pg-2", message: "I choose the other option." } });
    assert.equal(chosen.statusCode, 200, chosen.body); choiceId = chosen.json().acceptedChoice.acceptedChoiceId;
  } finally { await first.close(); }

  const restartConfig = resolveRuntimeConfig({ DATABASE_URL: databaseUrl!, LATTICE_DEPLOYMENT_MODE: "development", LATTICE_TRUTH_MODE: "v36-offline", LATTICE_AUTO_MIGRATE: "false", LATTICE_AUTHENTICATION_MODE: "development-fixture", LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "m4-pg-user" } as NodeJS.ProcessEnv);
  const second = await createRuntimeApp(restartConfig, { solandraCognition: new C(), solandraAdvisory: advisory });
  try {
    const continuity = await second.inject({ method: "GET", url: `/api/v1/conversations/${conversationId}/continuity` });
    assert.equal(continuity.statusCode, 200, continuity.body);
    assert.equal(continuity.json().recommendations.length, 1);
    assert.equal(continuity.json().recommendations[0].runId, null);
    assert.equal(continuity.json().acceptedChoices.length, 1);
    assert.equal(continuity.json().acceptedChoices[0].acceptedChoiceId, choiceId);
    assert.equal(continuity.json().acceptedChoices[0].authorizationGranted, false);
  } finally { await second.close(); }
});
