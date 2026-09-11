import assert from "node:assert/strict";
import test from "node:test";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import { renderSolandraAuthoritativeConversationPage } from "../src/ui/solandra-authoritative-conversation-page.js";
import { renderSolandraValidatorConversationPage } from "../src/ui/solandra-validator-conversation-page.js";

function validatorConfig() {
  return resolveRuntimeConfig({
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_VALIDATOR_DEPLOYMENT: "true",
    LATTICE_AUTO_MIGRATE: "false",
  });
}

test("validator deployment reuses the fixed development subject boundary without Owner or database state", () => {
  const config = validatorConfig();
  assert.equal(config.validatorDeployment, true);
  assert.equal(config.deploymentMode, "development");
  assert.equal(config.authenticationMode, "development-fixture");
  assert.equal(config.developmentFixtureSubjectId, "validator");
  assert.equal(config.databaseUrl, undefined);
});

test("validator deployment rejects state or credentials that could cross the Owner boundary", () => {
  assert.throws(
    () => resolveRuntimeConfig({
      LATTICE_DEPLOYMENT_MODE: "development",
      LATTICE_VALIDATOR_DEPLOYMENT: "true",
      DATABASE_URL: "postgres://owner-state.example/lattice",
    }),
    /requires isolated in-memory state/,
  );
  assert.throws(
    () => resolveRuntimeConfig({
      LATTICE_DEPLOYMENT_MODE: "development",
      LATTICE_VALIDATOR_DEPLOYMENT: "true",
      LATTICE_OWNER_ACCESS_TOKEN: "owner-access-" + "x".repeat(40),
    }),
    /forbids LATTICE_OWNER_ACCESS_TOKEN/,
  );
  assert.throws(
    () => resolveRuntimeConfig({
      LATTICE_DEPLOYMENT_MODE: "durable",
      LATTICE_VALIDATOR_DEPLOYMENT: "true",
      DATABASE_URL: "postgres://isolated.example/lattice",
    }),
    /requires development deployment mode/,
  );
  assert.throws(
    () => resolveRuntimeConfig({
      LATTICE_DEPLOYMENT_MODE: "development",
      LATTICE_VALIDATOR_DEPLOYMENT: "true",
      LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "owner",
    }),
    /fixes the authenticated subject to validator/,
  );
});

test("validator deployment accepts ordinary unauthenticated API requests only as the non-Owner validator subject", async () => {
  const app = await createRuntimeApp(validatorConfig(), { memoryDispatchDelayMs: 5_000 });
  try {
    const created = await app.inject({ method: "POST", url: "/api/v1/conversations" });
    assert.equal(created.statusCode, 201, created.body);
    const conversation = created.json<{ conversation: { ownerSubjectId: string } }>().conversation;
    assert.equal(conversation.ownerSubjectId, "validator");
    assert.notEqual(conversation.ownerSubjectId, "owner");
  } finally {
    await app.close();
  }
});

test("validator page clears only browser conversation restoration state before canonical recovery starts", () => {
  const canonical = renderSolandraAuthoritativeConversationPage();
  const validator = renderSolandraValidatorConversationPage();
  const storageKeys = [
    "lattice.solandra.conversation.v1",
    "lattice.solandra.pending-turn.v1",
    "lattice.solandra.active-work.v1",
    "lattice.solandra.clarification.v1",
    "lattice.solandra.draft.v1",
  ];

  assert.doesNotMatch(canonical, /for \(const key of keys\)/u);
  for (const key of storageKeys) assert.match(validator, new RegExp(key.replaceAll(".", "\\."), "u"));
  const resetIndex = validator.indexOf("window.localStorage.removeItem(key)");
  const recoveryIndex = validator.indexOf("void recoverSession()");
  assert.ok(resetIndex >= 0 && recoveryIndex > resetIndex, "validator storage reset must run before canonical recovery");
  assert.match(validator, /const ensureConversation = async \(\) =>/u);
  assert.match(validator, /const postTurnRecord = async \(record\) =>/u);
});

test("canonical root selects the fresh-session wrapper only for the validator deployment environment", async () => {
  const previous = process.env.LATTICE_VALIDATOR_DEPLOYMENT;
  process.env.LATTICE_VALIDATOR_DEPLOYMENT = "true";
  const app = await createRuntimeApp(validatorConfig(), { memoryDispatchDelayMs: 5_000 });
  try {
    const root = await app.inject({ method: "GET", url: "/" });
    assert.equal(root.statusCode, 200);
    assert.match(root.body, /window\.localStorage\.removeItem\(key\)/u);
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.LATTICE_VALIDATOR_DEPLOYMENT;
    else process.env.LATTICE_VALIDATOR_DEPLOYMENT = previous;
  }
});
