import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalApp as buildApp } from "../src/http-app.js";
import type {
  KnowledgeAcquisitionProvider,
  KnowledgeAcquisitionRequest,
  KnowledgeAcquisitionResult,
} from "../src/knowledge/acquisition.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";

class EmptyLiveKnowledgeProvider implements KnowledgeAcquisitionProvider {
  readonly kind = "health-live-fixture";

  async acquire(_request: KnowledgeAcquisitionRequest): Promise<KnowledgeAcquisitionResult> {
    return { sources: [], claims: [] };
  }
}

test("health endpoint reports composed offline truth and async dispatch lifecycle mode", async () => {
  const app = buildApp();
  const response = await app.inject({ method: "GET", url: "/health" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    status: "ok",
    mode: "fixture",
    truth: "v36-offline",
    lifecycle: "async-dispatch",
  });
  await app.close();
});


test("health endpoint reports the live truth state actually composed by the runtime", async () => {
  const config = resolveRuntimeConfig({
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-live",
    LATTICE_AUTHENTICATION_MODE: "development-fixture",
  } as NodeJS.ProcessEnv);
  const app = await createRuntimeApp(config, {
    knowledgeAcquisitionProvider: new EmptyLiveKnowledgeProvider(),
  });
  const response = await app.inject({ method: "GET", url: "/health" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    status: "ok",
    mode: "fixture",
    truth: "v36-live",
    lifecycle: "async-dispatch",
  });
  await app.close();
});
