import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import {
  MemoryIntentAuthorityStore,
  PostgresIntentAuthorityStore,
  type IntentAuthorityStore,
  type IntentTransitionCommand,
} from "../src/intent/index.js";
import { migrateRuntimeDatabase } from "../src/runtime-app.js";

function transition(
  scopeId: string,
  transitionId: string,
  turn: string,
  horizon: number,
  baseIntentVersionId: string | null,
  operations: IntentTransitionCommand["operations"],
): IntentTransitionCommand {
  return {
    transitionId,
    intentScopeId: scopeId,
    baseIntentVersionId,
    logicalUserTurnId: turn,
    observedMessageHorizon: horizon,
    sourceMessageId: `message-${turn}`,
    sourceDigest: `digest-${turn}`,
    operations,
  };
}

async function seed(store: IntentAuthorityStore, scopeId: string): Promise<string> {
  const scope = await store.createScope({
    intentScopeId: scopeId,
    initialTransition: transition(scopeId, randomUUID(), "turn-1", 1, null, [
      { op: "SET", path: { kind: "OBJECTIVE" }, value: { state: "VALUE", value: "choose a laptop" } },
    ]),
  });
  return scope.currentIntentVersionId;
}

async function createStaleByLaterPending(
  store: IntentAuthorityStore,
  scopeId: string,
  baseIntentVersionId: string,
  firstProposalId: string,
  secondProposalId: string,
) {
  const first = await store.createPendingProposal({
    proposalId: firstProposalId,
    intentScopeId: scopeId,
    baseIntentVersionId,
    observedMessageHorizon: 4,
    sourceMessageId: "message-turn-4",
    sourceDigest: "digest-turn-4",
    operations: [
      { op: "SET", path: { kind: "PREFERENCE", key: "color" }, value: { state: "VALUE", value: "black" } },
    ],
    materiality: "MATERIAL",
  });
  const later = await store.createPendingProposal({
    proposalId: secondProposalId,
    intentScopeId: scopeId,
    baseIntentVersionId,
    observedMessageHorizon: 5,
    sourceMessageId: "message-turn-5",
    sourceDigest: "digest-turn-5",
    operations: [
      { op: "SET", path: { kind: "PREFERENCE", key: "color" }, value: { state: "VALUE", value: "silver" } },
    ],
    materiality: "MATERIAL",
  });
  assert.equal(later.status, "PENDING");
  assert.equal((await store.getVersion(baseIntentVersionId))?.version !== undefined, true);
  return first;
}

test("pending material meaning remains non-authoritative until exact fresh USER confirmation", async () => {
  const ids = ["v1", "v2", "v3"];
  const store = new MemoryIntentAuthorityStore(() => ids.shift() ?? "unexpected");
  try {
    const base = await seed(store, "scope-1");
    const pending = await store.createPendingProposal({
      proposalId: "proposal-1",
      intentScopeId: "scope-1",
      baseIntentVersionId: base,
      observedMessageHorizon: 2,
      sourceMessageId: "message-turn-2",
      sourceDigest: "digest-turn-2",
      operations: [
        { op: "SET", path: { kind: "REQUIREMENT", key: "battery" }, value: { state: "VALUE", value: 12 } },
      ],
      materiality: "MATERIAL",
    });

    assert.equal(pending.status, "PENDING");
    assert.equal((await store.getScope("scope-1"))?.currentIntentVersionId, base);
    assert.equal((await store.getVersion(base))?.version, 1);

    const wrong = await store.confirmPendingProposal({
      transitionId: "confirm-wrong",
      proposalId: pending.proposalId,
      expectedProposalDigest: "not-the-proposal",
      intentScopeId: "scope-1",
      baseIntentVersionId: base,
      logicalUserTurnId: "turn-3-wrong",
      observedMessageHorizon: 3,
      sourceMessageId: "message-turn-3-wrong",
      sourceDigest: "digest-turn-3-wrong",
    });
    assert.equal(wrong.disposition, "REJECTED_INVALID");
    assert.equal((await store.getPendingProposal(pending.proposalId))?.status, "PENDING");

    const confirmation = {
      transitionId: "confirm-1",
      proposalId: pending.proposalId,
      expectedProposalDigest: pending.proposalDigest,
      intentScopeId: "scope-1",
      baseIntentVersionId: base,
      logicalUserTurnId: "turn-3",
      observedMessageHorizon: 3,
      sourceMessageId: "message-turn-3",
      sourceDigest: "digest-turn-3",
    };
    const confirmed = await store.confirmPendingProposal(confirmation);
    assert.equal(confirmed.disposition, "COMMITTED");
    const replay = await store.confirmPendingProposal(confirmation);
    assert.equal(replay.disposition, "REPLAYED");
    assert.equal(replay.replayedDisposition, "COMMITTED");
    const wrongDigestReplay = await store.confirmPendingProposal({
      ...confirmation,
      expectedProposalDigest: "different-digest",
    });
    assert.equal(wrongDigestReplay.disposition, "REJECTED_INVALID");
    assert.equal((await store.getPendingProposal(pending.proposalId))?.status, "CONFIRMED");
    assert.ok(confirmed.resultingIntentVersionId);
    const version = await store.getVersion(confirmed.resultingIntentVersionId);
    const provenance = version?.state.requirements.battery?.provenance;
    assert.equal(provenance?.kind, "USER_CONFIRMED");
    if (provenance?.kind === "USER_CONFIRMED") {
      assert.equal(provenance.proposalId, pending.proposalId);
      assert.equal(provenance.proposalDigest, pending.proposalDigest);
    }

    const staleBase = confirmed.resultingIntentVersionId;
    assert.ok(staleBase);
    const staleProposal = await createStaleByLaterPending(
      store,
      "scope-1",
      staleBase,
      "proposal-stale",
      "proposal-later",
    );
    assert.equal((await store.getScope("scope-1"))?.currentIntentVersionId, staleBase);
    const staleConfirmation = {
      transitionId: "confirm-stale",
      proposalId: staleProposal.proposalId,
      expectedProposalDigest: staleProposal.proposalDigest,
      intentScopeId: "scope-1",
      baseIntentVersionId: staleBase,
      logicalUserTurnId: "turn-6",
      observedMessageHorizon: 6,
      sourceMessageId: "message-turn-6",
      sourceDigest: "digest-turn-6",
    };
    const stale = await store.confirmPendingProposal(staleConfirmation);
    assert.equal(stale.disposition, "REJECTED_STALE");
    const staleReplay = await store.confirmPendingProposal(staleConfirmation);
    assert.equal(staleReplay.disposition, "REPLAYED");
    assert.equal(staleReplay.replayedDisposition, "REJECTED_STALE");
    assert.equal((await store.getPendingProposal(staleProposal.proposalId))?.status, "STALE");
  } finally {
    await store.close();
  }
});

const databaseUrl = process.env.DATABASE_URL;

test("PostgreSQL pending clarification survives restart and later pending USER horizon stales earlier proposal", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  await migrateRuntimeDatabase(databaseUrl);
  const scopeId = `clarification-${randomUUID()}`;
  let store = await PostgresIntentAuthorityStore.connect(databaseUrl, { migrate: false });
  try {
    const base = await seed(store, scopeId);
    const pending = await store.createPendingProposal({
      proposalId: randomUUID(),
      intentScopeId: scopeId,
      baseIntentVersionId: base,
      observedMessageHorizon: 2,
      sourceMessageId: "message-turn-2",
      sourceDigest: "digest-turn-2",
      operations: [
        { op: "SET", path: { kind: "PREFERENCE", key: "weight" }, value: { state: "OPEN" } },
      ],
      materiality: "MATERIAL",
    });
    await store.close();

    store = await PostgresIntentAuthorityStore.connect(databaseUrl, { migrate: false });
    const restored = await store.getPendingProposal(pending.proposalId);
    assert.equal(restored?.status, "PENDING");
    assert.equal((await store.getScope(scopeId))?.currentIntentVersionId, base);

    const command = {
      transitionId: randomUUID(),
      proposalId: pending.proposalId,
      expectedProposalDigest: pending.proposalDigest,
      intentScopeId: scopeId,
      baseIntentVersionId: base,
      logicalUserTurnId: "turn-3",
      observedMessageHorizon: 3,
      sourceMessageId: "message-turn-3",
      sourceDigest: "digest-turn-3",
    };
    const committed = await store.confirmPendingProposal(command);
    assert.equal(committed.disposition, "COMMITTED");
    const replay = await store.confirmPendingProposal(command);
    assert.equal(replay.disposition, "REPLAYED");
    assert.equal(replay.replayedDisposition, "COMMITTED");
    const wrongDigestReplay = await store.confirmPendingProposal({
      ...command,
      expectedProposalDigest: "different-digest",
    });
    assert.equal(wrongDigestReplay.disposition, "REJECTED_INVALID");
    assert.equal((await store.getPendingProposal(pending.proposalId))?.status, "CONFIRMED");

    assert.ok(committed.resultingIntentVersionId);
    const staleProposal = await createStaleByLaterPending(
      store,
      scopeId,
      committed.resultingIntentVersionId,
      randomUUID(),
      randomUUID(),
    );
    assert.equal((await store.getScope(scopeId))?.currentIntentVersionId, committed.resultingIntentVersionId);
    const staleCommand = {
      transitionId: randomUUID(),
      proposalId: staleProposal.proposalId,
      expectedProposalDigest: staleProposal.proposalDigest,
      intentScopeId: scopeId,
      baseIntentVersionId: committed.resultingIntentVersionId,
      logicalUserTurnId: "turn-6",
      observedMessageHorizon: 6,
      sourceMessageId: "message-turn-6",
      sourceDigest: "digest-turn-6",
    };
    const stale = await store.confirmPendingProposal(staleCommand);
    assert.equal(stale.disposition, "REJECTED_STALE");
    const staleReplay = await store.confirmPendingProposal(staleCommand);
    assert.equal(staleReplay.disposition, "REPLAYED");
    assert.equal(staleReplay.replayedDisposition, "REJECTED_STALE");
  } finally {
    await store.close();
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query("DELETE FROM intent_scopes WHERE intent_scope_id=$1", [scopeId]);
    } finally {
      await pool.end();
    }
  }
});
