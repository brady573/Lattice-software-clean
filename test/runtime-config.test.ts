import assert from "node:assert/strict";
import test from "node:test";
import { resolveRuntimeConfig } from "../src/runtime-config.js";

test("development defaults allow fixture mode and automatic development migrations", () => {
  const config = resolveRuntimeConfig({});
  assert.equal(config.deploymentMode, "development");
  assert.equal(config.truthMode, "v36-offline");
  assert.equal(config.authenticationMode, "development-fixture");
  assert.equal(config.developmentFixtureSubjectId, "fixture-user");
  assert.equal(config.databaseUrl, undefined);
  assert.equal(config.autoMigrate, true);
  assert.equal(config.localModelProviderBaseUrl, undefined);
  assert.equal(config.localModelProviderModel, "offline-prototype");
  assert.equal(config.modelSimulatorBaseUrl, undefined);
  assert.equal(config.modelSimulatorModel, "offline-prototype");
  assert.equal(config.androidModelRelayToken, undefined);
  assert.equal(config.androidModelRelayModel, "android-local-prototype");
  assert.equal(config.androidModelRelayTimeoutMs, 45_000);
});

test("development fixture authentication may use an explicit local subject", () => {
  const config = resolveRuntimeConfig({
    LATTICE_AUTHENTICATION_MODE: "development-fixture",
    LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: " local-user ",
  });
  assert.equal(config.authenticationMode, "development-fixture");
  assert.equal(config.developmentFixtureSubjectId, "local-user");
});

test("development may require real authenticated subject resolution without fixture fallback", () => {
  const config = resolveRuntimeConfig({ LATTICE_AUTHENTICATION_MODE: "required" });
  assert.equal(config.authenticationMode, "required");
  assert.equal(config.developmentFixtureSubjectId, undefined);
});

test("required authentication rejects fixture subject configuration", () => {
  assert.throws(
    () => resolveRuntimeConfig({
      LATTICE_AUTHENTICATION_MODE: "required",
      LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "fixture-user",
    }),
    /requires development-fixture authentication mode/,
  );
});

test("unknown authentication modes fail closed", () => {
  assert.throws(
    () => resolveRuntimeConfig({ LATTICE_AUTHENTICATION_MODE: "provider-specific" }),
    /Unsupported LATTICE_AUTHENTICATION_MODE/,
  );
});

test("development may opt into a first-class loopback local model provider", () => {
  const config = resolveRuntimeConfig({
    LATTICE_LOCAL_MODEL_PROVIDER_BASE_URL: "  http://127.0.0.1:11434/v1//  ",
    LATTICE_LOCAL_MODEL_PROVIDER_MODEL: "qwen3:8b",
  });
  assert.equal(config.localModelProviderBaseUrl, "http://127.0.0.1:11434/v1");
  assert.equal(config.localModelProviderModel, "qwen3:8b");
  assert.equal(config.modelSimulatorBaseUrl, "http://127.0.0.1:11434/v1");
  assert.equal(config.modelSimulatorModel, "qwen3:8b");
});

test("legacy simulator variables remain compatible with the local model provider slot", () => {
  const config = resolveRuntimeConfig({
    LATTICE_MODEL_SIMULATOR_BASE_URL: "  http://127.0.0.1:4010/v1//  ",
    LATTICE_MODEL_SIMULATOR_MODEL: "simulation-v7",
  });
  assert.equal(config.localModelProviderBaseUrl, "http://127.0.0.1:4010/v1");
  assert.equal(config.localModelProviderModel, "simulation-v7");
  assert.equal(config.modelSimulatorBaseUrl, "http://127.0.0.1:4010/v1");
  assert.equal(config.modelSimulatorModel, "simulation-v7");
});

test("modern and legacy local model provider variables cannot be mixed", () => {
  assert.throws(
    () => resolveRuntimeConfig({
      LATTICE_LOCAL_MODEL_PROVIDER_BASE_URL: "http://127.0.0.1:11434/v1",
      LATTICE_MODEL_SIMULATOR_MODEL: "legacy-model",
    }),
    /not both/,
  );
});

test("development may opt into an authenticated Android model relay", () => {
  const token = "a".repeat(32);
  const config = resolveRuntimeConfig({
    LATTICE_ANDROID_MODEL_RELAY_TOKEN: token,
    LATTICE_ANDROID_MODEL_RELAY_MODEL: "qwen-local",
    LATTICE_ANDROID_MODEL_RELAY_TIMEOUT_MS: "60000",
  });
  assert.equal(config.androidModelRelayToken, token);
  assert.equal(config.androidModelRelayModel, "qwen-local");
  assert.equal(config.androidModelRelayTimeoutMs, 60_000);
});

test("Android relay requires a non-trivial shared token", () => {
  assert.throws(
    () => resolveRuntimeConfig({ LATTICE_ANDROID_MODEL_RELAY_TOKEN: "too-short" }),
    /between 32 and 512/,
  );
});

test("local model provider configuration fails closed for non-loopback endpoints", () => {
  assert.throws(
    () => resolveRuntimeConfig({
      LATTICE_LOCAL_MODEL_PROVIDER_BASE_URL: "https://api.example.com/v1",
    }),
    /loopback/,
  );
});

test("local model provider and Android relay cannot be enabled together", () => {
  assert.throws(
    () => resolveRuntimeConfig({
      LATTICE_LOCAL_MODEL_PROVIDER_BASE_URL: "http://127.0.0.1:11434/v1",
      LATTICE_ANDROID_MODEL_RELAY_TOKEN: "b".repeat(32),
    }),
    /either the local model provider or the Android model relay/,
  );
});

test("durable deployment fails closed without PostgreSQL", () => {
  assert.throws(
    () => resolveRuntimeConfig({ LATTICE_DEPLOYMENT_MODE: "durable" }),
    /requires DATABASE_URL/,
  );
});

test("durable deployment requires authenticated subject resolution by default", () => {
  const config = resolveRuntimeConfig({
    LATTICE_DEPLOYMENT_MODE: "durable",
    DATABASE_URL: "postgresql://example.invalid/lattice",
  });
  assert.equal(config.authenticationMode, "required");
  assert.equal(config.developmentFixtureSubjectId, undefined);
});

test("durable deployment rejects development fixture authentication", () => {
  assert.throws(
    () => resolveRuntimeConfig({
      LATTICE_DEPLOYMENT_MODE: "durable",
      DATABASE_URL: "postgresql://example.invalid/lattice",
      LATTICE_AUTHENTICATION_MODE: "development-fixture",
    }),
    /cannot be enabled in durable deployment mode/,
  );
});

test("durable deployment rejects the development-only local model provider", () => {
  assert.throws(
    () => resolveRuntimeConfig({
      LATTICE_DEPLOYMENT_MODE: "durable",
      DATABASE_URL: "postgresql://example.invalid/lattice",
      LATTICE_LOCAL_MODEL_PROVIDER_BASE_URL: "http://127.0.0.1:11434/v1",
    }),
    /development-only/,
  );
});

test("durable deployment rejects the development-only Android model relay", () => {
  assert.throws(
    () => resolveRuntimeConfig({
      LATTICE_DEPLOYMENT_MODE: "durable",
      DATABASE_URL: "postgresql://example.invalid/lattice",
      LATTICE_ANDROID_MODEL_RELAY_TOKEN: "c".repeat(32),
    }),
    /development-only/,
  );
});

test("durable deployment defaults to no automatic database mutation", () => {
  const config = resolveRuntimeConfig({
    LATTICE_DEPLOYMENT_MODE: "durable",
    DATABASE_URL: "postgresql://example.invalid/lattice",
  });
  assert.equal(config.autoMigrate, false);
});

test("unknown truth modes fail closed", () => {
  assert.throws(
    () => resolveRuntimeConfig({ LATTICE_TRUTH_MODE: "live-unqualified" }),
    /Unsupported LATTICE_TRUTH_MODE/,
  );
});

test("live Knowledge acquisition is an explicit replaceable truth mode", () => {
  const config = resolveRuntimeConfig({
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-live",
  } as NodeJS.ProcessEnv);
  assert.equal(config.truthMode, "v36-live");
});
