import assert from "node:assert/strict";
import test from "node:test";
import {
  MemoryIntentAuthorityStore,
  type IntentTransitionCommand,
} from "../src/intent/index.js";

function transition(
  id: string,
  turn: string,
  baseIntentVersionId: string | null,
  operations: IntentTransitionCommand["operations"],
): IntentTransitionCommand {
  return {
    transitionId: id,
    intentScopeId: "scope-1",
    baseIntentVersionId,
    logicalUserTurnId: turn,
    observedMessageHorizon: Number(turn.replace(/\D/g, "")) || 1,
    sourceMessageId: `message-${turn}`,
    sourceDigest: `digest-${turn}`,
    operations,
  };
}

test("Memory Intent Authority creates immutable lineage, semantic no-ops, replay, and stale rejection", async () => {
  const ids = ["version-1", "version-2", "version-3"];
  const store = new MemoryIntentAuthorityStore(() => ids.shift() ?? "unexpected");
  const initial = transition("transition-1", "turn-1", null, [
    { op: "SET", path: { kind: "OBJECTIVE" }, value: { state: "VALUE", value: "choose a laptop" } },
    { op: "SET", path: { kind: "REQUIREMENT", key: "budget" }, value: { state: "VALUE", value: 1300 } },
  ]);
  const scope = await store.createScope({ intentScopeId: "scope-1", initialTransition: initial });
  assert.equal(scope.currentIntentVersionId, "version-1");
  const v1Before = await store.getVersion("version-1");
  assert.equal(v1Before?.version, 1);

  const committed = transition("transition-2", "turn-2", "version-1", [
    { op: "SET", path: { kind: "PREFERENCE", key: "performance" }, value: { state: "OPEN" } },
  ]);
  assert.deepEqual(await store.applyTransition(committed), {
    disposition: "COMMITTED",
    resultingIntentVersionId: "version-2",
    versionNumber: 2,
  });
  assert.equal((await store.getScope("scope-1"))?.currentIntentVersionId, "version-2");

  const noop = transition("transition-3", "turn-3", "version-2", [
    { op: "SET", path: { kind: "PREFERENCE", key: "performance" }, value: { state: "OPEN" } },
  ]);
  assert.deepEqual(await store.applyTransition(noop), {
    disposition: "SEMANTIC_NOOP",
    resultingIntentVersionId: "version-2",
    versionNumber: 2,
  });
  const replay = await store.applyTransition(noop);
  assert.equal(replay.disposition, "REPLAYED");
  assert.equal(replay.replayedDisposition, "SEMANTIC_NOOP");
  assert.equal(replay.resultingIntentVersionId, "version-2");

  const conflict = { ...noop, transitionId: "transition-3-conflict", sourceDigest: "different" };
  assert.equal((await store.applyTransition(conflict)).disposition, "REJECTED_INVALID");

  const stale = transition("transition-4", "turn-4", "version-1", [
    { op: "SET", path: { kind: "REQUIREMENT", key: "battery" }, value: { state: "VALUE", value: 12 } },
  ]);
  assert.equal((await store.applyTransition(stale)).disposition, "REJECTED_STALE");
  assert.deepEqual(await store.getVersion("version-1"), v1Before);
  assert.equal((await store.getVersion("version-2"))?.predecessorIntentVersionId, "version-1");
  await store.close();
});

test("competing same-base memory transitions allow only one head advancement", async () => {
  const ids = ["v1", "v2", "v3"];
  const store = new MemoryIntentAuthorityStore(() => ids.shift() ?? "unexpected");
  await store.createScope({
    intentScopeId: "scope-1",
    initialTransition: transition("t1", "turn-1", null, [
      { op: "SET", path: { kind: "OBJECTIVE" }, value: { state: "VALUE", value: "choose" } },
    ]),
  });
  const [a, b] = await Promise.all([
    store.applyTransition(transition("t2", "turn-2", "v1", [
      { op: "SET", path: { kind: "REQUIREMENT", key: "a" }, value: { state: "VALUE", value: true } },
    ])),
    store.applyTransition(transition("t3", "turn-3", "v1", [
      { op: "SET", path: { kind: "REQUIREMENT", key: "b" }, value: { state: "VALUE", value: true } },
    ])),
  ]);
  assert.deepEqual([a.disposition, b.disposition].sort(), ["COMMITTED", "REJECTED_STALE"]);
  assert.equal((await store.getScope("scope-1"))?.nextVersionNumber, 3);
  await store.close();
});
