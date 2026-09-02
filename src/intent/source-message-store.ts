import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";

const migration = "027_intent_user_messages.sql" as const;

export interface IntentUserMessageInput {
  conversationId: string;
  intentScopeId: string;
  logicalUserTurnId: string;
  messageId: string;
  messageHorizon: number;
  content: string;
}

export interface IntentUserMessage extends IntentUserMessageInput {
  origin: "USER";
  contentDigest: string;
  createdAt: string;
}

export interface IntentUserMessageStore {
  readonly kind: "memory" | "postgres";
  append(input: IntentUserMessageInput): Promise<IntentUserMessage>;
  get(messageId: string): Promise<IntentUserMessage | undefined>;
  listByConversation(conversationId: string): Promise<IntentUserMessage[]>;
  close(): Promise<void>;
}

function contentDigest(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function validateInput(input: IntentUserMessageInput): void {
  if (
    input.conversationId.trim().length === 0
    || input.intentScopeId.trim().length === 0
    || input.logicalUserTurnId.trim().length === 0
    || input.messageId.trim().length === 0
    || input.content.trim().length === 0
    || !Number.isSafeInteger(input.messageHorizon)
    || input.messageHorizon < 0
  ) {
    throw new Error("Intent USER message provenance is invalid.");
  }
}

function sameMessage(left: IntentUserMessage, right: IntentUserMessage): boolean {
  return left.conversationId === right.conversationId
    && left.intentScopeId === right.intentScopeId
    && left.logicalUserTurnId === right.logicalUserTurnId
    && left.messageId === right.messageId
    && left.messageHorizon === right.messageHorizon
    && left.content === right.content
    && left.contentDigest === right.contentDigest
    && left.origin === right.origin;
}

function compareConversationMessages(left: IntentUserMessage, right: IntentUserMessage): number {
  if (left.createdAt !== right.createdAt) return left.createdAt.localeCompare(right.createdAt);
  if (left.messageHorizon !== right.messageHorizon) return left.messageHorizon - right.messageHorizon;
  return left.messageId.localeCompare(right.messageId);
}

function materialize(input: IntentUserMessageInput, createdAt = new Date().toISOString()): IntentUserMessage {
  validateInput(input);
  return {
    ...structuredClone(input),
    origin: "USER",
    contentDigest: contentDigest(input.content),
    createdAt,
  };
}

export class MemoryIntentUserMessageStore implements IntentUserMessageStore {
  readonly kind = "memory" as const;
  private readonly byId = new Map<string, IntentUserMessage>();
  private readonly byTurn = new Map<string, IntentUserMessage>();
  private readonly byHorizon = new Map<string, IntentUserMessage>();

  private turnKey(input: Pick<IntentUserMessageInput, "intentScopeId" | "logicalUserTurnId">): string {
    return `${input.intentScopeId}\u001f${input.logicalUserTurnId}`;
  }

  private horizonKey(input: Pick<IntentUserMessageInput, "intentScopeId" | "messageHorizon">): string {
    return `${input.intentScopeId}\u001f${input.messageHorizon}`;
  }

  async append(input: IntentUserMessageInput): Promise<IntentUserMessage> {
    const candidate = materialize(input);
    const existing = this.byId.get(candidate.messageId)
      ?? this.byTurn.get(this.turnKey(candidate))
      ?? this.byHorizon.get(this.horizonKey(candidate));
    if (existing) {
      if (!sameMessage(existing, candidate)) {
        throw new Error("Intent USER message identity was reused with different provenance.");
      }
      return structuredClone(existing);
    }
    this.byId.set(candidate.messageId, structuredClone(candidate));
    this.byTurn.set(this.turnKey(candidate), structuredClone(candidate));
    this.byHorizon.set(this.horizonKey(candidate), structuredClone(candidate));
    return structuredClone(candidate);
  }

  async get(messageId: string): Promise<IntentUserMessage | undefined> {
    const message = this.byId.get(messageId);
    return message ? structuredClone(message) : undefined;
  }

  async listByConversation(conversationId: string): Promise<IntentUserMessage[]> {
    const normalizedConversationId = conversationId.trim();
    if (!normalizedConversationId) return [];
    return [...this.byId.values()]
      .filter((message) => message.conversationId === normalizedConversationId)
      .sort(compareConversationMessages)
      .map((message) => structuredClone(message));
  }

  async close(): Promise<void> {
    this.byId.clear();
    this.byTurn.clear();
    this.byHorizon.clear();
  }
}

type UserMessageRow = {
  conversation_id: string;
  intent_scope_id: string;
  logical_user_turn_id: string;
  message_id: string;
  message_horizon: string | number;
  content: string;
  content_digest: string;
  origin: "USER";
  created_at: Date | string;
};

function fromRow(row: UserMessageRow): IntentUserMessage {
  return {
    conversationId: row.conversation_id,
    intentScopeId: row.intent_scope_id,
    logicalUserTurnId: row.logical_user_turn_id,
    messageId: row.message_id,
    messageHorizon: Number(row.message_horizon),
    content: row.content,
    contentDigest: row.content_digest,
    origin: row.origin,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export class PostgresIntentUserMessageStore implements IntentUserMessageStore {
  readonly kind = "postgres" as const;

  private constructor(private readonly pool: Pool) {}

  static async migrate(databaseUrl: string): Promise<void> {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query(
        "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
      );
      const existing = await pool.query<{ name: string }>(
        "SELECT name FROM schema_migrations WHERE name=$1",
        [migration],
      );
      if ((existing.rowCount ?? 0) > 0) return;
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
      } finally {
        client.release();
      }
    } finally {
      await pool.end();
    }
  }

  static async connect(databaseUrl: string, options: { migrate?: boolean } = {}): Promise<PostgresIntentUserMessageStore> {
    if (options.migrate) await PostgresIntentUserMessageStore.migrate(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl });
    const ready = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM schema_migrations WHERE name=$1",
      [migration],
    );
    if (ready.rows[0]?.count !== "1") {
      await pool.end();
      throw new Error(`Intent USER message schema is not ready; required migration ${migration} is missing.`);
    }
    return new PostgresIntentUserMessageStore(pool);
  }

  async append(input: IntentUserMessageInput): Promise<IntentUserMessage> {
    const candidate = materialize(input);
    await this.pool.query(
      `INSERT INTO intent_user_messages(
         conversation_id,intent_scope_id,logical_user_turn_id,message_id,message_horizon,
         content,content_digest,origin
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'USER')
       ON CONFLICT DO NOTHING`,
      [
        candidate.conversationId,
        candidate.intentScopeId,
        candidate.logicalUserTurnId,
        candidate.messageId,
        candidate.messageHorizon,
        candidate.content,
        candidate.contentDigest,
      ],
    );

    const result = await this.pool.query<UserMessageRow>(
      `SELECT conversation_id,intent_scope_id,logical_user_turn_id,message_id,message_horizon,
              content,content_digest,origin,created_at
       FROM intent_user_messages
       WHERE message_id=$1
          OR (intent_scope_id=$2 AND logical_user_turn_id=$3)
          OR (intent_scope_id=$2 AND message_horizon=$4)
       ORDER BY created_at ASC`,
      [candidate.messageId, candidate.intentScopeId, candidate.logicalUserTurnId, candidate.messageHorizon],
    );
    const exact = result.rows.map(fromRow).find((record) => sameMessage(record, candidate));
    if (!exact || result.rows.length !== 1) {
      throw new Error("Intent USER message identity was reused with different provenance.");
    }
    return exact;
  }

  async get(messageId: string): Promise<IntentUserMessage | undefined> {
    const result = await this.pool.query<UserMessageRow>(
      `SELECT conversation_id,intent_scope_id,logical_user_turn_id,message_id,message_horizon,
              content,content_digest,origin,created_at
       FROM intent_user_messages WHERE message_id=$1`,
      [messageId],
    );
    return result.rows[0] ? fromRow(result.rows[0]) : undefined;
  }

  async listByConversation(conversationId: string): Promise<IntentUserMessage[]> {
    const normalizedConversationId = conversationId.trim();
    if (!normalizedConversationId) return [];
    const result = await this.pool.query<UserMessageRow>(
      `SELECT conversation_id,intent_scope_id,logical_user_turn_id,message_id,message_horizon,
              content,content_digest,origin,created_at
       FROM intent_user_messages
       WHERE conversation_id=$1
       ORDER BY created_at ASC, message_horizon ASC, message_id ASC`,
      [normalizedConversationId],
    );
    return result.rows.map(fromRow);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}