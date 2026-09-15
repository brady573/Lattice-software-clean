import assert from "node:assert/strict";
import test from "node:test";
import type { KnowledgeAcquisitionProvider } from "../src/knowledge/acquisition.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import { createStandaloneRunWorker } from "../src/run-worker-process.js";
import { createConfiguredTruthPipeline } from "../src/truth/configured-pipeline.js";

const liveConfigurationError = /LATTICE_TRUTH_MODE=v36-live requires configured Solandra Knowledge investigation/u;

function config(env: NodeJS.ProcessEnv) {
  return resolveRuntimeConfig({
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_AUTHENTICATION_MODE: "development-fixture",
    LATTICE_TRUTH_MODE: "v36-live",
    ...env,
  });
}

test("v36-offline remains composable without live investigation configuration", () => {
  assert.doesNotThrow(() => createConfiguredTruthPipeline("v36-offline"));
});

test("canonical v36-live fails composition when no Solandra Knowledge investigator is configured", () => {
  const runtimeConfig = config({});
  assert.throws(
    () => createConfiguredTruthPipeline("v36-live", undefined, undefined, runtimeConfig),
    liveConfigurationError,
  );
});

test("canonical v36-live Groq route fails immediately without its credential", () => {
  assert.throws(
    () => config({ LATTICE_SOLANDRA_COGNITION_ROUTE: "groq-gpt-oss-120b" }),
    /requires GROQ_API_KEY/u,
  );
});

test("canonical v36-live composes with the configured Groq investigation route", () => {
  const runtimeConfig = config({
    LATTICE_SOLANDRA_COGNITION_ROUTE: "groq-gpt-oss-120b",
    GROQ_API_KEY: "0123456789abcdef",
  });
  assert.doesNotThrow(
    () => createConfiguredTruthPipeline("v36-live", undefined, undefined, runtimeConfig),
  );
});

test("canonical v36-live composes with the configured local model investigation route", () => {
  const runtimeConfig = config({
    LATTICE_LOCAL_MODEL_PROVIDER_BASE_URL: "http://127.0.0.1:11434/v1",
    LATTICE_LOCAL_MODEL_PROVIDER_MODEL: "qwen3:4b-instruct",
  });
  assert.doesNotThrow(
    () => createConfiguredTruthPipeline("v36-live", undefined, undefined, runtimeConfig),
  );
});

test("an explicitly injected acquisition provider remains an explicit integration seam", () => {
  const provider: KnowledgeAcquisitionProvider = {
    kind: "explicit-test-provider",
    async acquire() {
      return { sources: [], claims: [] };
    },
  };
  const runtimeConfig = config({});
  assert.doesNotThrow(
    () => createConfiguredTruthPipeline("v36-live", provider, undefined, runtimeConfig),
  );
});

test("standalone Run worker rejects impossible canonical v36-live before opening PostgreSQL", async () => {
  const savedRoute = process.env.LATTICE_SOLANDRA_COGNITION_ROUTE;
  const savedKey = process.env.GROQ_API_KEY;
  const savedBaseUrl = process.env.LATTICE_LOCAL_MODEL_PROVIDER_BASE_URL;
  const savedModel = process.env.LATTICE_LOCAL_MODEL_PROVIDER_MODEL;
  delete process.env.LATTICE_SOLANDRA_COGNITION_ROUTE;
  delete process.env.GROQ_API_KEY;
  delete process.env.LATTICE_LOCAL_MODEL_PROVIDER_BASE_URL;
  delete process.env.LATTICE_LOCAL_MODEL_PROVIDER_MODEL;
  try {
    await assert.rejects(
      () => createStandaloneRunWorker({
        databaseUrl: "postgresql://127.0.0.1:1/must-not-be-contacted",
        workerId: "truthfulness-test-worker",
        pollMs: 50,
        leaseMs: 30_000,
        retryDelayMs: 1_000,
        batchSize: 1,
        truthMode: "v36-live",
      }),
      liveConfigurationError,
    );
  } finally {
    if (savedRoute === undefined) delete process.env.LATTICE_SOLANDRA_COGNITION_ROUTE;
    else process.env.LATTICE_SOLANDRA_COGNITION_ROUTE = savedRoute;
    if (savedKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = savedKey;
    if (savedBaseUrl === undefined) delete process.env.LATTICE_LOCAL_MODEL_PROVIDER_BASE_URL;
    else process.env.LATTICE_LOCAL_MODEL_PROVIDER_BASE_URL = savedBaseUrl;
    if (savedModel === undefined) delete process.env.LATTICE_LOCAL_MODEL_PROVIDER_MODEL;
    else process.env.LATTICE_LOCAL_MODEL_PROVIDER_MODEL = savedModel;
  }
});
