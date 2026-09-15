import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import {
  buildConversationReference,
  type ConversationReferenceRecord,
} from "../src/conversation/conversation-reference-store.js";
import { PostgresConversationStore } from "../src/conversation/conversation-store.js";
import {
  PostgresIntentAuthorityStore,
  PostgresIntentUserMessageStore,
  type IntentTransitionCommand,
} from "../src/intent/index.js";
import { PostgresKnowledgeRecordStore } from "../src/knowledge/knowledge-record-store.js";
import { migrateRuntimeDatabase } from "../src/runtime-app.js";

const databaseUrl = process.env.DATABASE_URL;
const migration041 = "041_conversation_reference_knowledge_backfill.sql" as const;

function isolatedDatabaseUrl(base: string, schema: string): string {
  const url = new URL(base);
  url.searchParams.set("options", `-c search_path=${schema}`);
  return url.toString();
}

function initialTransition(
  intentScopeId: string,
  messageId: string,
  objective: string,
): IntentTransitionCommand {
  return {
    transitionId: `transition-${randomUUID()}`,
    intentScopeId,
    baseIntentVersionId: null,
    logicalUserTurnId: `turn-${randomUUID()}`,
    observedMessageHorizon: 1,
    sourceMessageId: messageId,
    sourceDigest: "a".repeat(64),
    operations: [
      {
        op: "SET",
        path: { kind: "OBJECTIVE" },
        value: { state: "VALUE", value: objective },
      },
    ],
  };
}

type GovernedAuthorityFixture = {
  conversationId: string;
  intentScopeId: string;
  intentVersionId: string;
  firstMessageId: string;
  secondMessageId: string;
  knowledgeId: string;
};

async function seedGovernedAuthority(
  scopedUrl: string,
  pool: Pool,
  label: string,
): Promise<GovernedAuthorityFixture> {
  const conversationId = `conversation-${label}-${randomUUID()}`;
  const intentScopeId = `scope-${label}-${randomUUID()}`;
  const firstMessageId = `message-${label}-1-${randomUUID()}`;
  const secondMessageId = `message-${label}-2-${randomUUID()}`;
  const knowledgeId = `knowledge-${label}-${randomUUID()}`;
  const runId = randomUUID();
  const objective = `Preserve governed historical Knowledge continuity for ${label}.`;

  const conversationStore = await PostgresConversationStore.connect(scopedUrl, { migrate: false });
  const intentStore = await PostgresIntentAuthorityStore.connect(scopedUrl, { migrate: false });
  const userMessageStore = await PostgresIntentUserMessageStore.connect(scopedUrl, { migrate: false });
  const knowledgeStore = await PostgresKnowledgeRecordStore.connect(scopedUrl);
  try {
    await conversationStore.create(conversationId, "issue-91-upgrade-owner");
    const scope = await intentStore.createScope({
      intentScopeId,
      initialTransition: initialTransition(intentScopeId, firstMessageId, objective),
    });
    const intentVersionId = scope.currentIntentVersionId;

    await userMessageStore.append({
      conversationId,
      intentScopeId,
      logicalUserTurnId: "turn-1",
      messageId: firstMessageId,
      messageHorizon: 1,
      content: `Initial governed question for ${label}.`,
    });
    await userMessageStore.append({
      conversationId,
      intentScopeId,
      logicalUserTurnId: "turn-2",
      messageId: secondMessageId,
      messageHorizon: 2,
      content: `Follow-up governed reference for ${label}.`,
    });

    await pool.query(
      `INSERT INTO runs(id,conversation_id,status,request_json,decision_json,explanation)
       VALUES ($1,$2,'COMPLETED',$3::jsonb,NULL,NULL)`,
      [
        runId,
        conversationId,
        JSON.stringify({
          kind: "consultation",
          objective,
          context: [],
          investigationQueries: [],
          advisoryRequested: false,
          decisionNeed: "NONE",
          resourceNeed: "NONE",
          sourceMessageId: firstMessageId,
          sourceMessageDigest: "a".repeat(64),
          intentVersion: 1,
          intentScopeId,
          intentVersionId,
        }),
      ],
    );

    await knowledgeStore.putKnowledge({
      knowledgeId,
      conversationId,
      runId,
      intentScopeId,
      intentVersionId,
      sourceMessageId: firstMessageId,
      objective,
      claimIds: [`claim-${label}`],
      sourceIds: [`source-${label}`],
      evidenceIds: [`evidence-${label}`],
      truthAssessmentIds: [`assessment-${label}`],
      uncertainties: [],
      asOf: "2026-09-10T09:00:00.000Z",
      createdAt: "2026-09-10T09:00:00.000Z",
    });

    return {
      conversationId,
      intentScopeId,
      intentVersionId,
      firstMessageId,
      secondMessageId,
      knowledgeId,
    };
  } finally {
    await knowledgeStore.close();
    await userMessageStore.close();
    await intentStore.close();
    await conversationStore.close();
  }
}

type PersistedReferenceRow = {
  reference_id: string;
  conversation_id: string;
  user_message_id: string;
  response_id: string;
  intent_version_id: string;
  targets: Array<{ kind: string; targetId: string; relation: string }>;
  parent_reference_id: string | null;
  created_at: Date | string;
};

function normalizePersistedReference(row: PersistedReferenceRow): ConversationReferenceRecord {
  return {
    referenceId: row.reference_id,
    conversationId: row.conversation_id,
    userMessageId: row.user_message_id,
    responseId: row.response_id,
    intentVersionId: row.intent_version_id,
    targets: row.targets as ConversationReferenceRecord["targets"],
    parentReferenceId: row.parent_reference_id,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

async function translatedReferences(pool: Pool): Promise<ConversationReferenceRecord[]> {
  const result = await pool.query<PersistedReferenceRow>(
    `SELECT reference_id,conversation_id,user_message_id,response_id,intent_version_id,
            targets,parent_reference_id,created_at
       FROM conversation_references
      ORDER BY created_at,reference_id`,
  );
  return result.rows.map(normalizePersistedReference);
}

async function migration041Count(pool: Pool): Promise<string> {
  const result = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM schema_migrations WHERE name=$1",
    [migration041],
  );
  return result.rows[0]?.count ?? "0";
}

test(
  "Issue #91: canonical runtime migration upgrades legacy Knowledge continuity without inventing authority",
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl);
    const admin = new Pool({ connectionString: databaseUrl });
    const schema = `issue91_upgrade_${randomUUID().replaceAll("-", "")}`;
    const scopedUrl = isolatedDatabaseUrl(databaseUrl, schema);
    const pool = new Pool({ connectionString: scopedUrl });

    try {
      await admin.query(`CREATE SCHEMA ${schema}`);

      // Build a genuine current schema first, then restore only the historical
      // pre-041 continuity condition. This keeps every prerequisite table and
      // authority relation in a state a prior Lattice database could occupy.
      await migrateRuntimeDatabase(scopedUrl);
      const authorityA = await seedGovernedAuthority(scopedUrl, pool, "valid-a");

      const producedCreatedAt = "2026-09-10T10:00:00.000Z";
      const consumedCreatedAt = "2026-09-10T10:05:00.000Z";
      const producedResponseId = `run:${randomUUID()}:outcome`;
      const consumedResponseId = `knowledge:${authorityA.knowledgeId}:reference:${authorityA.secondMessageId}`;
      const legacyProducedId = `legacy-established-${randomUUID()}`;
      const legacyConsumedId = `legacy-referenced-${randomUUID()}`;

      const expectedProduced = buildConversationReference({
        conversationId: authorityA.conversationId,
        userMessageId: authorityA.firstMessageId,
        responseId: producedResponseId,
        intentVersionId: authorityA.intentVersionId,
        targets: [{ kind: "KNOWLEDGE", targetId: authorityA.knowledgeId, relation: "PRODUCED" }],
        parentReferenceId: null,
        createdAt: producedCreatedAt,
      });
      const expectedConsumed = buildConversationReference({
        conversationId: authorityA.conversationId,
        userMessageId: authorityA.secondMessageId,
        responseId: consumedResponseId,
        intentVersionId: authorityA.intentVersionId,
        targets: [{ kind: "KNOWLEDGE", targetId: authorityA.knowledgeId, relation: "CONSUMED" }],
        parentReferenceId: expectedProduced.referenceId,
        createdAt: consumedCreatedAt,
      });

      await pool.query(
        `INSERT INTO conversation_knowledge_references(
           reference_id,conversation_id,user_message_id,response_id,intent_version_id,
           knowledge_id,reference_kind,parent_reference_id,created_at
         ) VALUES
           ($1,$2,$3,$4,$5,$6,'ESTABLISHED',NULL,$7),
           ($8,$2,$9,$10,$5,$6,'REFERENCED',$1,$11)`,
        [
          legacyProducedId,
          authorityA.conversationId,
          authorityA.firstMessageId,
          producedResponseId,
          authorityA.intentVersionId,
          authorityA.knowledgeId,
          producedCreatedAt,
          legacyConsumedId,
          authorityA.secondMessageId,
          consumedResponseId,
          consumedCreatedAt,
        ],
      );
      await pool.query("DELETE FROM conversation_references");
      await pool.query("DELETE FROM schema_migrations WHERE name=$1", [migration041]);
      assert.equal(await migration041Count(pool), "0");

      // Acceptance must flow through the production migration composition.
      await migrateRuntimeDatabase(scopedUrl);

      const firstUpgrade = await translatedReferences(pool);
      assert.deepEqual(firstUpgrade, [expectedProduced, expectedConsumed]);
      assert.equal(firstUpgrade[0]?.conversationId, authorityA.conversationId);
      assert.equal(firstUpgrade[0]?.userMessageId, authorityA.firstMessageId);
      assert.equal(firstUpgrade[0]?.intentVersionId, authorityA.intentVersionId);
      assert.equal(firstUpgrade[0]?.responseId, producedResponseId);
      assert.equal(firstUpgrade[0]?.createdAt, producedCreatedAt);
      assert.deepEqual(firstUpgrade[0]?.targets, [{
        kind: "KNOWLEDGE",
        targetId: authorityA.knowledgeId,
        relation: "PRODUCED",
      }]);
      assert.equal(firstUpgrade[1]?.conversationId, authorityA.conversationId);
      assert.equal(firstUpgrade[1]?.userMessageId, authorityA.secondMessageId);
      assert.equal(firstUpgrade[1]?.intentVersionId, authorityA.intentVersionId);
      assert.equal(firstUpgrade[1]?.responseId, consumedResponseId);
      assert.equal(firstUpgrade[1]?.createdAt, consumedCreatedAt);
      assert.deepEqual(firstUpgrade[1]?.targets, [{
        kind: "KNOWLEDGE",
        targetId: authorityA.knowledgeId,
        relation: "CONSUMED",
      }]);
      assert.equal(firstUpgrade[1]?.parentReferenceId, expectedProduced.referenceId);
      assert.equal(await migration041Count(pool), "1");

      const legacyBeforeReplay = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM conversation_knowledge_references",
      );
      assert.equal(legacyBeforeReplay.rows[0]?.count, "2");

      await migrateRuntimeDatabase(scopedUrl);
      const replayed = await translatedReferences(pool);
      assert.deepEqual(replayed, firstUpgrade, "replay must preserve exact canonical identities and continuity");
      assert.equal(new Set(replayed.map((reference) => reference.referenceId)).size, 2);
      const legacyAfterReplay = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM conversation_knowledge_references",
      );
      assert.equal(legacyAfterReplay.rows[0]?.count, "2", "upgrade must not create new legacy ownership");
      assert.equal(await migration041Count(pool), "1");

      // Restore an unapplied marker and add database-valid but authority-invalid
      // legacy state. Valid earlier translations may remain because #91 is
      // restartable/idempotent; global rollback belongs to Issue #100.
      const authorityB = await seedGovernedAuthority(scopedUrl, pool, "invalid-b");
      const malformedCreatedAt = "2026-09-10T10:10:00.000Z";
      const malformedResponseId = `knowledge:${authorityB.knowledgeId}:malformed-cross-conversation`;
      const malformedLegacyId = `legacy-malformed-${randomUUID()}`;
      const malformedCandidate = buildConversationReference({
        conversationId: authorityA.conversationId,
        userMessageId: authorityA.firstMessageId,
        responseId: malformedResponseId,
        intentVersionId: authorityA.intentVersionId,
        targets: [{ kind: "KNOWLEDGE", targetId: authorityB.knowledgeId, relation: "PRODUCED" }],
        parentReferenceId: null,
        createdAt: malformedCreatedAt,
      });

      await pool.query("DELETE FROM schema_migrations WHERE name=$1", [migration041]);
      await pool.query(
        `INSERT INTO conversation_knowledge_references(
           reference_id,conversation_id,user_message_id,response_id,intent_version_id,
           knowledge_id,reference_kind,parent_reference_id,created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,'ESTABLISHED',NULL,$7)`,
        [
          malformedLegacyId,
          authorityA.conversationId,
          authorityA.firstMessageId,
          malformedResponseId,
          authorityA.intentVersionId,
          authorityB.knowledgeId,
          malformedCreatedAt,
        ],
      );
      assert.equal(await migration041Count(pool), "0");

      await assert.rejects(
        migrateRuntimeDatabase(scopedUrl),
        /ConversationReference Knowledge must exist in the same Conversation\./u,
      );

      const afterMalformedFailure = await translatedReferences(pool);
      assert.deepEqual(
        afterMalformedFailure,
        firstUpgrade,
        "valid canonical translations may remain stable when a later malformed legacy row fails",
      );
      assert.equal(
        afterMalformedFailure.some((reference) => reference.referenceId === malformedCandidate.referenceId),
        false,
        "malformed authority must not be reconstructed as canonical continuity",
      );
      assert.equal(await migration041Count(pool), "0", "041 must not record completion after authority failure");
      const legacyAfterFailure = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM conversation_knowledge_references",
      );
      assert.equal(legacyAfterFailure.rows[0]?.count, "3");
    } finally {
      await pool.end();
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  },
);
