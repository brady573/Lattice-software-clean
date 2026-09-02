import assert from "node:assert/strict";
import test from "node:test";
import {
  applyIntentOperations,
  emptyIntentState,
  intentStatesSemanticallyEqual,
  readIntentValue,
  type IntentTransitionCommand,
} from "../src/intent/index.js";

function command(
  operations: IntentTransitionCommand["operations"],
  sourceMessageId = "message-1",
): IntentTransitionCommand {
  return {
    transitionId: `transition-${sourceMessageId}`,
    intentScopeId: "scope-1",
    baseIntentVersionId: null,
    logicalUserTurnId: `turn-${sourceMessageId}`,
    observedMessageHorizon: 1,
    sourceMessageId,
    sourceDigest: `digest-${sourceMessageId}`,
    operations,
  };
}

test("Intent reducer applies SET/REMOVE/NO_CHANGE without treating omission as removal", () => {
  const initial = applyIntentOperations(emptyIntentState(), command([
    { op: "SET", path: { kind: "OBJECTIVE" }, value: { state: "VALUE", value: "choose a laptop" } },
    { op: "SET", path: { kind: "REQUIREMENT", key: "budget" }, value: { state: "VALUE", value: 1300 } },
    { op: "SET", path: { kind: "PREFERENCE", key: "color" }, value: { state: "NO_PREFERENCE" } },
  ]));
  const next = applyIntentOperations(initial, command([
    { op: "NO_CHANGE", path: { kind: "OBJECTIVE" } },
    { op: "REMOVE", path: { kind: "PREFERENCE", key: "color" } },
  ], "message-2"));
  assert.equal(next.objective?.value.state, "VALUE");
  assert.equal(next.requirements.budget?.value.state, "VALUE");
  assert.deepEqual(readIntentValue(next, { kind: "PREFERENCE", key: "color" }), { state: "UNSPECIFIED" });
  assert.deepEqual(readIntentValue(next, { kind: "REQUIREMENT", key: "battery" }), { state: "UNSPECIFIED" });
  assert.equal(next.requirements.budget?.provenance.sourceMessageId, "message-1");
});

test("Intent semantic equality ignores reaffirming provenance but not semantic values", () => {
  const first = applyIntentOperations(emptyIntentState(), command([
    { op: "SET", path: { kind: "OBJECTIVE" }, value: { state: "VALUE", value: "choose a laptop" } },
  ]));
  const reaffirmed = applyIntentOperations(first, command([
    { op: "SET", path: { kind: "OBJECTIVE" }, value: { state: "VALUE", value: "choose a laptop" } },
  ], "message-2"));
  const changed = applyIntentOperations(first, command([
    { op: "SET", path: { kind: "OBJECTIVE" }, value: { state: "VALUE", value: "choose a tablet" } },
  ], "message-3"));
  assert.equal(intentStatesSemanticallyEqual(first, reaffirmed), true);
  assert.equal(intentStatesSemanticallyEqual(first, changed), false);
});

test("UNSPECIFIED is explicit at the semantic boundary but cannot bypass REMOVE through SET", () => {
  assert.deepEqual(readIntentValue(emptyIntentState(), { kind: "OBJECTIVE" }), { state: "UNSPECIFIED" });
  assert.throws(() => applyIntentOperations(emptyIntentState(), command([
    { op: "SET", path: { kind: "OBJECTIVE" }, value: { state: "UNSPECIFIED" } } as never,
  ])));
});

test("Intent reducer fails closed on duplicate field operations", () => {
  assert.throws(() => applyIntentOperations(emptyIntentState(), command([
    { op: "SET", path: { kind: "REQUIREMENT", key: "budget" }, value: { state: "VALUE", value: 1300 } },
    { op: "REMOVE", path: { kind: "REQUIREMENT", key: "budget" } },
  ])), /Duplicate intent operation path/);
});
