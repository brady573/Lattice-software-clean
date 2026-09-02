import assert from "node:assert/strict";
import test from "node:test";
import {
  MemoryIntentAuthorityStore,
  emptyIntentState,
  readIntentValue,
  type IntentCorrectionCommand,
  type IntentResetCommand,
  type IntentRevertCommand,
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
    intentScopeId: "scope-lineage",
    baseIntentVersionId,
    logicalUserTurnId: `turn-${turn}`,
    observedMessageHorizon: turn,
    sourceMessageId: `message-${turn}`,
    sourceDigest: `digest-${turn}`,
    operations,
  };
}

function correction(
  id: string,
  turn: number,
  baseIntentVersionId: string,
  correctsIntentVersionId: string,
  operations: IntentCorrectionCommand["operations"],
): IntentCorrectionCommand {
  return {
    transitionId: id,
    intentScopeId: "scope-lineage",
    baseIntentVersionId,
    correctsIntentVersionId,
    logicalUserTurnId: `turn-${turn}`,
    observedMessageHorizon: turn,
    sourceMessageId: `message-${turn}`,
    sourceDigest: `digest-${turn}`,
    operations,
  };
}

function revert(
  id: string,
  turn: number,
  baseIntentVersionId: string,
  revertsIntentVersionId: string,
): IntentRevertCommand {
  return {
    transitionId: id,
    intentScopeId: "scope-lineage",
    baseIntentVersionId,
    revertsIntentVersionId,
    logicalUserTurnId: `turn-${turn}`,
    observedMessageHorizon: turn,
    sourceMessageId: `message-${turn}`,
    sourceDigest: `digest-${turn}`,
  };
}

function reset(id: string, turn: number, baseIntentVersionId: string): IntentResetCommand {
  return {
    transitionId: id,
    intentScopeId: "scope-lineage",
    baseIntentVersionId,
    logicalUserTurnId: `turn-${turn}`,
    observedMessageHorizon: turn,
    sourceMessageId: `message-${turn}`,
    sourceDigest: `digest-${turn}`,
  };
}

test("Memory Intent Authority appends immutable correction, targeted revert, and reset lineage", async () => {
  const ids = ["v1", "v2", "v3", "v4", "v5"];
  const store = new MemoryIntentAuthorityStore(() => ids.shift() ?? "unexpected");
  try {
    await store.createScope({
      intentScopeId: "scope-lineage",
      initialTransition: transition("t1", 1, null, [
        { op: "SET", path: { kind: "OBJECTIVE" }, value: { state: "VALUE", value: "choose a laptop" } },
        { op: "SET", path: { kind: "REQUIREMENT", key: "budget" }, value: { state: "VALUE", value: 1300 } },
      ]),
    });
    const v1Before = await store.getVersion("v1");
    assert.equal(v1Before?.lineageKind, "INITIAL");
    assert.equal(v1Before?.lineageTargetIntentVersionId, null);

    assert.equal((await store.applyTransition(transition("t2", 2, "v1", [
      { op: "SET", path: { kind: "PREFERENCE", key: "performance" }, value: { state: "OPEN" } },
    ]))).disposition, "COMMITTED");
    const v2Before = await store.getVersion("v2");
    assert.equal(v2Before?.lineageKind, "UPDATE");

    const corrected = await store.applyCorrection(correction("t3", 3, "v2", "v1", [
      { op: "SET", path: { kind: "REQUIREMENT", key: "budget" }, value: { state: "VALUE", value: 1500 } },
    ]));
    assert.deepEqual(corrected, { disposition: "COMMITTED", resultingIntentVersionId: "v3", versionNumber: 3 });
    const v3 = await store.getVersion("v3");
    assert.equal(v3?.predecessorIntentVersionId, "v2");
    assert.equal(v3?.lineageKind, "CORRECTION");
    assert.equal(v3?.lineageTargetIntentVersionId, "v1");
    assert.equal(readIntentValue(v3?.state ?? emptyIntentState(), { kind: "REQUIREMENT", key: "budget" }).state, "VALUE");
    assert.equal(
      (readIntentValue(v3?.state ?? emptyIntentState(), { kind: "REQUIREMENT", key: "budget" }) as { state: "VALUE"; value: number }).value,
      1500,
    );

    const unsafeRevert = revert("t4", 4, "v3", "v1");
    assert.equal((await store.revertVersion(unsafeRevert)).disposition, "REJECTED_INVALID");
    const unsafeReplay = await store.revertVersion(unsafeRevert);
    assert.equal(unsafeReplay.disposition, "REPLAYED");
    assert.equal(unsafeReplay.replayedDisposition, "REJECTED_INVALID");
    assert.equal((await store.getScope("scope-lineage"))?.currentIntentVersionId, "v3");

    const reverted = await store.revertVersion(revert("t5", 5, "v3", "v2"));
    assert.deepEqual(reverted, { disposition: "COMMITTED", resultingIntentVersionId: "v4", versionNumber: 4 });
    const v4 = await store.getVersion("v4");
    assert.equal(v4?.predecessorIntentVersionId, "v3");
    assert.equal(v4?.lineageKind, "REVERT");
    assert.equal(v4?.lineageTargetIntentVersionId, "v2");
    assert.equal(readIntentValue(v4?.state ?? emptyIntentState(), { kind: "PREFERENCE", key: "performance" }).state, "UNSPECIFIED");
    assert.equal(
      (readIntentValue(v4?.state ?? emptyIntentState(), { kind: "REQUIREMENT", key: "budget" }) as { state: "VALUE"; value: number }).value,
      1500,
    );

    const resetCommand = reset("t6", 6, "v4");
    assert.deepEqual(await store.resetScope(resetCommand), {
      disposition: "COMMITTED",
      resultingIntentVersionId: "v5",
      versionNumber: 5,
    });
    const v5 = await store.getVersion("v5");
    assert.equal(v5?.predecessorIntentVersionId, "v4");
    assert.equal(v5?.lineageKind, "RESET_SUPERSEDES");
    assert.equal(v5?.lineageTargetIntentVersionId, "v4");
    assert.deepEqual(v5?.state, emptyIntentState());

    const secondReset = reset("t7", 7, "v5");
    assert.deepEqual(await store.resetScope(secondReset), {
      disposition: "SEMANTIC_NOOP",
      resultingIntentVersionId: "v5",
      versionNumber: 5,
    });
    const resetReplay = await store.resetScope(secondReset);
    assert.equal(resetReplay.disposition, "REPLAYED");
    assert.equal(resetReplay.replayedDisposition, "SEMANTIC_NOOP");

    const staleCorrection = correction("t8", 8, "v4", "v4", [
      { op: "NO_CHANGE", path: { kind: "OBJECTIVE" } },
    ]);
    assert.equal((await store.applyCorrection(staleCorrection)).disposition, "REJECTED_STALE");
    assert.equal((await store.getScope("scope-lineage"))?.currentIntentVersionId, "v5");

    assert.deepEqual(await store.getVersion("v1"), v1Before);
    assert.deepEqual(await store.getVersion("v2"), v2Before);
  } finally {
    await store.close();
  }
});
