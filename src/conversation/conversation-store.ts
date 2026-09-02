import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";

const migrations = ["028_conversations.sql", "030_conversation_ownership.sql", "031_conversation_deletion.sql"] as const;
const OWNER_SUBJECT_ID_MAX_CHARS = 200;
const PURGE_CANDIDATE_LIMIT_MAX = 1000;

export interface Conversation {
  id: string;
  ownerSubjectId: string;
  createdAt: string;
  deletedAt: string | null;
}

export interface DeletedConversation extends Conversation {
  deletedAt: string;
}

export interface ConversationPurgeCandidateQuery {
  deletedBefore: string;
  limit?: number;
}

export interface ConversationStore {
  readonly kind: "memory" | "postgres";
  create(id: string, ownerSubjectId: string): Promise<Conversation>;
  get(id: string): Promise<Conversation | undefined>;
  getOwned(id: string, ownerSubjectId: string): Promise<Conversation | undefined>;
  getRetained(id: string): Promise<Conversation | undefined>;
  deleteOwned(id: string, ownerSubjectId: string): Promise<boolean>;
  listPurgeCandidates(query: ConversationPurgeCandidateQuery): Promise<DeletedConversation[]>;
  close(): Promise<void>;
}

function validateId(id: string): string {
  const normalized = id.trim();
  if (!normalized || normalized.length > 128) throw new Error("Conversation id is invalid.");
  return normalized;
}

function validateOwnerSubjectId(ownerSubjectId: string): string {
  const normalized = ownerSubjectId.trim();
  if (!normalized || normalized.length > OWNER_SUBJECT_ID_MAX_CHARS) {
    throw new Error("Conversation owner subject id is invalid.");
  }
  return normalized;
}

function validateDeletedBefore(value: string): string {
  const normalized = value.trim();
  const timestamp = Date.parse(normalized);
  if (!normalized || Number.isNaN(timestamp)) throw new Error("Purge candidate cutoff is invalid.");
  return new Date(timestamp).toISOString();
}

function validateCandidateLimit(value: number | undefined): number {
  if (value === undefined) return 100;
  if (!Number.isInteger(value) || value < 1 || value > PURGE_CANDIDATE_LIMIT_MAX) {
    throw new Error("Purge candidate limit is invalid.");
  }
  return value;
}

export class MemoryConversationStore implements ConversationStore {
  readonly kind = "memory" as const;
  private readonly conversations = new Map<string, Conversation>();

  async create(id: string, ownerSubjectId: string): Promise<Conversation> {
    const normalizedId = validateId(id);
    const normalizedOwner = validateOwnerSubjectId(ownerSubjectId);
    const existing = this.conversations.get(normalizedId);
    if (existing) {
      if (existing.ownerSubjectId !== normalizedOwner) throw new Error("Conversation id collision.");
      return structuredClone(existing);
    }
    const created: Conversation = {
      id: normalizedId,
      ownerSubjectId: normalizedOwner,
      createdAt: new Date().toISOString(),
      deletedAt: null,
    };
    this.conversations.set(normalizedId, structuredClone(created));
    return structuredClone(created);
  }

  async get(id: string): Promise<Conversation | undefined> {
    const conversation = this.conversations.get(validateId(id));
    return conversation && conversation.deletedAt === null ? structuredClone(conversation) : undefined;
  }

  async getOwned(id: string, ownerSubjectId: string): Promise<Conversation | undefined> {
    const conversation = this.conversations.get(validateId(id));
    const owner = validateOwnerSubjectId(ownerSubjectId);
    return conversation?.ownerSubjectId === owner && conversation.deletedAt === null
      ? structuredClone(conversation)
      : undefined;
  }

  async getRetained(id: string): Promise<Conversation | undefined> {
    const conversation = this.conversations.get(validateId(id));
    return conversation ? structuredClone(conversation) : undefined;
  }

  async deleteOwned(id: string, ownerSubjectId: string): Promise<boolean> {
    const normalizedId = validateId(id);
    const owner = validateOwnerSubjectId(ownerSubjectId);
    const conversation = this.conversations.get(normalizedId);
    if (!conversation || conversation.ownerSubjectId !== owner || conversation.deletedAt !== null) return false;
    conversation.deletedAt = new Date().toISOString();
    this.conversations.set(normalizedId, structuredClone(conversation));
    return true;
  }

  async listPurgeCandidates(query: ConversationPurgeCandidateQuery): Promise<DeletedConversation[]> {
    const cutoff = validateDeletedBefore(query.deletedBefore);
    const limit = validateCandidateLimit(query.limit);
    return [...this.conversations.values()]
      .filter((conversation): conversation is DeletedConversation => (
        conversation.deletedAt !== null && conversation.deletedAt <= cutoff
      ))
      .sort((left, right) => left.deletedAt.localeCompare(right.deletedAt) || left.id.localeCompare(right.id))
      .slice(0, limit)
      .map((conversation) => structuredClone(conversation));
  }

  async close(): Promise<void> { this.conversations.clear(); }
}

type ConversationRow = {
  id: string;
  owner_subject_id: string;
  created_at: Date | string;
  deleted_at: Date | string | null;
};

function fromRow(row: ConversationRow): Conversation {
  return {
    id: row.id,
    ownerSubjectId: row.owner_subject_id,
    createdAt: new Date(row.created_at).toISOString(),
    deletedAt: row.deleted_at === null ? null : new Date(row.deleted_at).toISOString(),
  };
}

export class PostgresConversationStore implements ConversationStore {
  readonly kind = "postgres" as const;
  private constructor(private readonly pool: Pool) {}

  static async migrate(databaseUrl: string): Promise<void> {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
      for (const migration of migrations) {
        const existing = await pool.query<{ name: string }>("SELECT name FROM schema_migrations WHERE name=$1", [migration]);
        if ((existing.rowCount ?? 0) > 0) continue;
        const sql = await readFile(resolve(process.cwd(), "migrations", migration), "utf8");
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(sql);
          await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [migration]);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally { client.release(); }
      }
    } finally { await pool.end(); }
  }

  static async connect(databaseUrl: string, options: { migrate?: boolean } = {}): Promise<PostgresConversationStore> {
    if (options.migrate) await PostgresConversationStore.migrate(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl });
    for (const migration of migrations) {
      const ready = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM schema_migrations WHERE name=$1", [migration]);
      if (ready.rows[0]?.count !== "1") {
        await pool.end();
        throw new Error(`Conversation schema is not ready; required migration ${migration} is missing.`);
      }
    }
    return new PostgresConversationStore(pool);
  }

  async create(id: string, ownerSubjectId: string): Promise<Conversation> {
    const normalizedId = validateId(id);
    const owner = validateOwnerSubjectId(ownerSubjectId);
    const result = await this.pool.query<ConversationRow>(
      `INSERT INTO conversations(id, owner_subject_id) VALUES ($1, $2)
       ON CONFLICT (id) DO NOTHING
       RETURNING id, owner_subject_id, created_at, deleted_at`, [normalizedId, owner]);
    if (result.rows[0]) return fromRow(result.rows[0]);
    const existing = await this.getOwned(normalizedId, owner);
    if (!existing) throw new Error("Conversation id collision.");
    return existing;
  }

  async get(id: string): Promise<Conversation | undefined> {
    const result = await this.pool.query<ConversationRow>(
      "SELECT id, owner_subject_id, created_at, deleted_at FROM conversations WHERE id=$1 AND owner_subject_id IS NOT NULL AND deleted_at IS NULL",
      [validateId(id)],
    );
    return result.rows[0] ? fromRow(result.rows[0]) : undefined;
  }

  async getOwned(id: string, ownerSubjectId: string): Promise<Conversation | undefined> {
    const result = await this.pool.query<ConversationRow>(
      "SELECT id, owner_subject_id, created_at, deleted_at FROM conversations WHERE id=$1 AND owner_subject_id=$2 AND deleted_at IS NULL",
      [validateId(id), validateOwnerSubjectId(ownerSubjectId)],
    );
    return result.rows[0] ? fromRow(result.rows[0]) : undefined;
  }

  async getRetained(id: string): Promise<Conversation | undefined> {
    const result = await this.pool.query<ConversationRow>(
      "SELECT id, owner_subject_id, created_at, deleted_at FROM conversations WHERE id=$1 AND owner_subject_id IS NOT NULL",
      [validateId(id)],
    );
    return result.rows[0] ? fromRow(result.rows[0]) : undefined;
  }

  async deleteOwned(id: string, ownerSubjectId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE conversations
       SET deleted_at=now()
       WHERE id=$1 AND owner_subject_id=$2 AND deleted_at IS NULL`,
      [validateId(id), validateOwnerSubjectId(ownerSubjectId)],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async listPurgeCandidates(query: ConversationPurgeCandidateQuery): Promise<DeletedConversation[]> {
    const cutoff = validateDeletedBefore(query.deletedBefore);
    const limit = validateCandidateLimit(query.limit);
    const result = await this.pool.query<ConversationRow>(
      `SELECT id, owner_subject_id, created_at, deleted_at
       FROM conversations
       WHERE owner_subject_id IS NOT NULL
         AND deleted_at IS NOT NULL
         AND deleted_at <= $1::timestamptz
       ORDER BY deleted_at ASC, id ASC
       LIMIT $2`,
      [cutoff, limit],
    );
    return result.rows.map((row) => {
      const conversation = fromRow(row);
      if (conversation.deletedAt === null) throw new Error("Purge candidate query returned an active conversation.");
      return { ...conversation, deletedAt: conversation.deletedAt };
    });
  }

  async close(): Promise<void> { await this.pool.end(); }
}
