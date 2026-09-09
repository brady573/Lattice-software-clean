import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { registerCapabilityBrokerApi } from "../dist/src/capabilities/api.js";
import { createConfiguredCapabilityBroker } from "../dist/src/capabilities/composition.js";
import { createRuntimeApp } from "../dist/src/runtime-app.js";
import { resolveRuntimeConfig } from "../dist/src/runtime-config.js";

const subjectId = "m3-live-user";
const expectedSha = process.env.LATTICE_M3_EXPECTED_SHA?.trim();
const expectedTree = process.env.LATTICE_M3_EXPECTED_TREE?.trim();
assert.ok(expectedSha && expectedTree, "M3 proof requires exact candidate SHA/tree inputs.");

const config = resolveRuntimeConfig({
  ...process.env,
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-offline",
  LATTICE_AUTHENTICATION_MODE: "development-fixture",
  LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: subjectId,
  LATTICE_SOLANDRA_COGNITION_ROUTE: "groq-gpt-oss-120b",
});
const composition = await createConfiguredCapabilityBroker(config);
assert.equal(composition.userModelConfigured, true);
const app = await createRuntimeApp(config, { memoryDispatchDelayMs: 1 });
registerCapabilityBrokerApi(app, composition.broker);

const artifact = {
  candidate: { sha: expectedSha, tree: expectedTree },
  capability: null,
  invocation: null,
  disconnected: null,
  revokedUseStatus: null,
};
try {
  const initial = await app.inject({ method: "GET", url: "/api/v1/capabilities/user-model" });
  assert.equal(initial.statusCode, 200, initial.body);
  assert.equal(initial.json().capability.authorized, false);

  const connected = await app.inject({ method: "POST", url: "/api/v1/capabilities/user-model/connect" });
  assert.equal(connected.statusCode, 200, connected.body);
  const capability = connected.json().capability;
  assert.equal(capability.capabilityId, "user-authorized-cognitive-model");
  assert.equal(capability.authorized, true);
  assert.equal(capability.effect, "COGNITIVE_ONLY");
  artifact.capability = capability;

  const invocation = await app.inject({
    method: "POST",
    url: "/api/v1/solandra/capabilities/user-model",
    payload: {
      requestId: randomUUID(),
      purpose: "Generate bounded alternatives from USER-authored material",
      input: {
        purpose: "BRAINSTORM",
        instruction: "Generate three concise alternative headings for the USER-authored note. Do not add factual claims.",
        userContext: ["Personal notes should be easy to sort without creating a complicated filing system."],
        governedKnowledge: [],
      },
    },
  });
  assert.equal(invocation.statusCode, 200, invocation.body);
  const result = invocation.json().result;
  assert.equal(result.capabilityId, "user-authorized-cognitive-model");
  assert.equal(result.requester, "SOLANDRA");
  assert.equal(result.effect, "COGNITIVE_ONLY");
  assert.equal(result.trustHandling, "NON_AUTHORITATIVE_PROPOSAL");
  assert.equal(result.output.authority, "NON_AUTHORITATIVE_PROPOSAL");
  assert.equal(result.output.factualTreatment, "REQUIRES_KNOWLEDGE_TRUST");
  assert.ok(typeof result.output.text === "string" && result.output.text.trim().length > 0);
  assert.equal(result.provenance.executionClass, "LIVE_DIRECT");
  assert.equal(result.provenance.routeMode, "PINNED");
  assert.equal(result.provenance.actualProvider, "groq");
  assert.equal(result.provenance.actualModel, "openai/gpt-oss-120b");
  assert.equal(result.provenance.routeProvenance, "COMPLETE");
  assert.doesNotMatch(JSON.stringify(result), /GROQ_API_KEY|Bearer\s+[A-Za-z0-9._-]+/u);
  artifact.invocation = result;

  const disconnected = await app.inject({ method: "DELETE", url: "/api/v1/capabilities/user-model/connect" });
  assert.equal(disconnected.statusCode, 200, disconnected.body);
  assert.equal(disconnected.json().capability.authorized, false);
  artifact.disconnected = disconnected.json().capability;

  const denied = await app.inject({
    method: "POST",
    url: "/api/v1/solandra/capabilities/user-model",
    payload: {
      requestId: randomUUID(),
      purpose: "must fail after revocation",
      input: { purpose: "BRAINSTORM", instruction: "Do not run.", userContext: [], governedKnowledge: [] },
    },
  });
  assert.equal(denied.statusCode, 403, denied.body);
  artifact.revokedUseStatus = denied.statusCode;

  const dir = resolve(process.env.LATTICE_M3_ARTIFACT_DIR ?? "artifacts/m3");
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "m3-live-user-model-proof.json"), JSON.stringify(artifact, null, 2));
  console.log("LATTICE_M3_LIVE_USER_MODEL=PASS");
} finally {
  await app.close();
  await composition.broker.close();
}
