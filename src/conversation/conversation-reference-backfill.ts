import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import {
  buildConversationReference,
  PostgresConversationReferenceStore,
  type ConversationReferenceAuthority,
  type ConversationReferenceRecord,
  type ConversationReferenceRelation,
} from "./conversation-reference-store.js";

const migration = "041_conversation_reference_knowledge_backfill.sql" as const;

type LegacyKnowledgeReferenceRow = {
  reference_id: string;
  conversation_id: string;
  user_message_id: string;
  response_id: string;
  intent_version_id: string;
  knowledge_id: string;
  reference_kind: "ESTABLISHED" | "REFERENCED";
  parent_reference_id: string | null;
  created_at: Date | string;
};

export interface ConversationReferenceKnowledgeBackfillResult {
  alreadyApplied: boolean;
  legacyRows: number;
  inserted: number;
  reused: number;
}

function createdAt(row: LegacyKnowledgeReferenceRow): string {
  return row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString();
}

function relationFor(kind: LegacyKnowledgeReferenceRow["reference_kind"]): ConversationReferenceRelation {
  return kind === "ESTABLISHED" ? "PRODUCED" : "CONSUMED";
}

function sameTranslation(
  existing: ConversationReferenceRecord,
  candidate: ConversationReferenceRecord,
): boolean {
  return existing.referenceId === candidate.referenceId
    && existing.conversationId === candidate.conversationId
    && existing.userMessageId === candidate.userMessageId
    && existing.responseId === candidate.responseId
    && existing.intentVersionId === candidate.intentVersionId
    && existing.createdAt === candidate.createdAt
    && JSON.stringify(existing.targets) === JSON.stringify(candidate.targets);
}

function postgresAuthority(pool: Pool): ConversationReferenceAuthority {
  return {
    conversationStore: {
      async get(id) {
        const result = await pool.query<{ id: string; owner_subject_id: string | null }>(
          "SELECT id, owner_subject_id FROM conversations WHERE id=$1",
          [id],
        );
        const row = result.rows[0];
        return row ? { id: row.id, ownerSubjectId: row.owner_subject_id ?? "legacy-backfill" } : undefined;
      },
    },
    userMessageStore: {
      async get(messageId) {
        const result = await pool.query<{
          message_id: string;
          conversation_id: string;
          intent_scope_id: string;
        }>(
          "SELECT message_id, conversation_id, intent_scope_id FROM intent_user_messages WHERE message_id=$1",
          [messageId],
        );
        const row = result.rows[0];
        return row
          ? {
            messageId: row.message_id,
            conversationId: row.conversation_id,
            intentScopeId: row.intent_scope_id,
          }
          : undefined;
      },
    },
    intentStore: {
      async getVersion(intentVersionId) {
        const result = await pool.query<{ intent_version_id: string; intent_scope_id: string }>(
          "SELECT intent_version_id, intent_scope_id FROM intent_versions WHERE intent_version_id=$1",
          [intentVersionId],
        );
        const row = result.rows[0];
        return row
          ? { intentVersionId: row.intent_version_id, intentScopeId: row.intent_scope_id }
          : undefined;
      },
    },
    knowledgeStore: {
      async getKnowledge(knowledgeId) {
        const result = await pool.query<{ knowledge_id: string; conversation_id: string }>(
          "SELECT knowledge_id, conversation_id FROM knowledge_records WHERE knowledge_id=$1",
          [knowledgeId],
        );
        const row = result.rows[0];
        return row ? { knowledgeId: row.knowledge_id, conversationId: row.conversation_id } : undefined;
      },
    },
    recommendationStore: {
      async getRecommendation() {
        return undefined;
      },
      async listRecommendationsByConversation() {
        return [];
      },
    },
    acceptedChoiceStore: {
      async getAcceptedChoice() {
        return undefined;
      },
    },
    preparedResourceStore: {
      async getPreparedResource() {
        return undefined;
      },
    },
  };
}

export async function backfillLegacyConversationKnowledgeReferences(
  databaseUrl: string,
): Promise<ConversationReferenceKnowledgeBackfillResult> {
  const pool = new Pool({ connectionString: databaseUrl });
  let store: PostgresConversationReferenceStore | undefined;
  try {
    await pool.query("SELECT 1");
    await pool.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const applied = await pool.query<{ name: string }>(
      "SELECT name FROM schema_migrations WHERE name=$1",
      [migration],
    );
    if ((applied.rowCount ?? 0) > 0) {
      return { alreadyApplied: true, legacyRows: 0, inserted: 0, reused: 0 };
    }

    // Keep an explicit migration artifact in the repository even though the
    // row transformation itself is code-driven so canonical identities and
    // admission checks are used instead of duplicated SQL semantics.
    await readFile(resolve(process.cwd(), "migrations", migration), "utf8");

    const legacy = await pool.query<LegacyKnowledgeReferenceRow>(
      `SELECT reference_id, conversation_id, user_message_id, response_id,
              intent_version_id, knowledge_id, reference_kind,
              parent_reference_id, created_at
         FROM conversation_knowledge_references
        ORDER BY created_at, reference_id`,
    );

    store = await PostgresConversationReferenceStore.connect(databaseUrl, postgresAuthority(pool));
    const byLegacyId = new Map(legacy.rows.map((row) => [row.reference_id, row] as const));
    const translatedIds = new Map<string, string>();
    const pending = new Map(byLegacyId);
    let inserted = 0;
    let reused = 0;

    while (pending.size > 0) {
      let progressed = false;
      for (const [legacyId, row] of [...pending.entries()]) {
        if (row.parent_reference_id !== null && !translatedIds.has(row.parent_reference_id)) {
          if (!byLegacyId.has(row.parent_reference_id)) {
            throw new Error(`Legacy Knowledge reference ${legacyId} has an unknown parent.`);
          }
          continue;
        }

        const candidate = buildConversationReference({
          conversationId: row.conversation_id,
          userMessageId: row.user_message_id,
          responseId: row.response_id,
          intentVersionId: row.intent_version_id,
          targets: [{
            kind: "KNOWLEDGE",
            targetId: row.knowledge_id,
            relation: relationFor(row.reference_kind),
          }],
          parentReferenceId: row.parent_reference_id === null
            ? null
            : translatedIds.get(row.parent_reference_id)!,
          createdAt: createdAt(row),
        });

        const existing = await store.getReference(candidate.referenceId);
        if (existing) {
          if (!sameTranslation(existing, candidate)) {
            throw new Error(
              `Existing ConversationReference ${candidate.referenceId} does not match the legacy Knowledge reference translation.`,
            );
          }
          reused += 1;
        } else {
          await store.putReference(candidate);
          inserted += 1;
        }

        translatedIds.set(legacyId, candidate.referenceId);
        pending.delete(legacyId);
        progressed = true;
      }

      if (!progressed) {
        throw new Error("Legacy Knowledge reference parent lineage could not be resolved without a cycle.");
      }
    }

    await pool.query(
      "INSERT INTO schema_migrations(name) VALUES ($1) ON CONFLICT(name) DO NOTHING",
      [migration],
    );
    return {
      alreadyApplied: false,
      legacyRows: legacy.rows.length,
      inserted,
      reused,
    };
  } finally {
    await store?.close();
    await pool.end();
  }
}
