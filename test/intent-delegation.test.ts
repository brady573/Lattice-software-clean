import assert from "node:assert/strict";
import test from "node:test";
import {
  MemoryIntentAuthorityStore,
  type IntentTransitionCommand,
} from "../src/intent/index.js";

function transition(
  id: string,
  turn: number,
  baseIntentVersionId: string | null,
  operations: IntentTransitionCommand["operations"],
): IntentTransitionCommand {
  return {
    transitionId: id,
    intentScopeId: "scope-delegation",
    baseIntentVersionId,
    logicalUserTurnId: `turn-${turn}`,
    observedMessageHorizon: turn,
    sourceMessageId: `message-${turn}`,
    sourceDigest: `digest-${turn}`,
    operations,
  };
}

test("bounded USER delegation is explicit, preference-scoped, provenance-bound, and revocable", async () => {
  const ids = ["v1", "v2", "v3"];
  const store = new MemoryIntentAuthorityStore(() => ids.shift() ?? "unexpected");

  await store.createScope({
    intentScopeId: "scope-delegation",
    initialTransition: transition("t1", 1, null, [
      { op: "SET", path: { kind: "OBJECTIVE" }, value: { state: "VALUE", value: "choose a laptop" } },
    ]),
  });

  const delegated = await store.applyTransition(transition("t2", 2, "v1", [
    { op: "SET", path: { kind: "PREFERENCE", key: "color" }, value: { state: "DELEGATED" } },
  ]));
  assert.deepEqual(delegated, {
    disposition: "COMMITTED",
    resultingIntentVersionId: "v2",
    versionNumber: 2,
  });

  const v2 = await store.getVersion("v2");
  assert.deepEqual(v2?.state.preferences.color?.value, { state: "DELEGATED" });
  assert.deepEqual(v2?.state.preferences.color?.provenance, {
    kind: "EXPLICIT_USER",
    logicalUserTurnId: "turn-2",
    sourceMessageId: "message-2",
    sourceDigest: "digest-2",
  });

  const reaffirmed = await store.applyTransition(transition("t3", 3, "v2", [
    { op: "SET", path: { kind: "PREFERENCE", key: "color" }, value: { state: "DELEGATED" } },
  ]));
  assert.deepEqual(reaffirmed, {
    disposition: "SEMANTIC_NOOP",
    resultingIntentVersionId: "v2",
    versionNumber: 2,
  });

  const revoked = await store.applyTransition(transition("t4", 4, "v2", [
    { op: "SET", path: { kind: "PREFERENCE", key: "color" }, value: { state: "VALUE", value: "black" } },
  ]));
  assert.deepEqual(revoked, {
    disposition: "COMMITTED",
    resultingIntentVersionId: "v3",
    versionNumber: 3,
  });
  assert.deepEqual((await store.getVersion("v3"))?.state.preferences.color?.value, {
    state: "VALUE",
    value: "black",
  });

  await store.close();
});

test("bounded delegation fails closed outside preference dimensions", async () => {
  const ids = ["v1", "unused"];
  const store = new MemoryIntentAuthorityStore(() => ids.shift() ?? "unexpected");

  await store.createScope({
    intentScopeId: "scope-delegation",
    initialTransition: transition("t1", 1, null, [
      { op: "SET", path: { kind: "OBJECTIVE" }, value: { state: "VALUE", value: "choose a laptop" } },
    ]),
  });

  const invalidRequirement = await store.applyTransition(transition("t2", 2, "v1", [
    { op: "SET", path: { kind: "REQUIREMENT", key: "budget" }, value: { state: "DELEGATED" } },
  ]));
  assert.deepEqual(invalidRequirement, {
    disposition: "REJECTED_INVALID",
    resultingIntentVersionId: null,
    versionNumber: null,
  });
  assert.equal((await store.getScope("scope-delegation"))?.currentIntentVersionId, "v1");

  await store.close();
});
