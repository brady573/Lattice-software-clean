import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";

const migrations = [
  "039_conversation_responses.sql",
  "042_conversation_response_presentation.sql",
] as const;
const MAX_ID_CHARS = 256;
const MAX_CONTENT_CHARS = 32_000;
const MAX_FRAME_CHARS = 4_000;
const MAX_COMPOSER_CHARS = 24_000;

export interface ConversationResponsePresentation {
  opening: string;
  composerBody: string | null;
  closing: string | null;
}

export interface ConversationResponse {
  responseId: string;
  conversationId: string;
  sourceMessageId: string;
  /** Full ordinary response text retained for bounded cognition continuity. */
  content: string;
  /** Structural surface roles. Older rows may legitimately omit this field. */
  presentation?: ConversationResponsePresentation;
  origin: "SOLANDRA";
  authority: "NON_AUTHORITATIVE_CONVERSATION";
  factualAuthority: false;
  createdAt: string;
}

export interface ConversationResponseStore {
  readonly kind: "memory" | "postgres";
  putResponse(response: ConversationResponse): Promise<ConversationResponse>;
  getResponse(responseId: string): Promise<ConversationResponse | undefined>;
  listByConversation(conversationId: string): Promise<ConversationResponse[]>;
  close(): Promise<void>;
}

function boundedId(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_ID_CHARS) throw new Error(`${name} is invalid.`);
  return normalized;
}

function boundedText(value: string, name: string, max: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new Error(`${name} is invalid.`);
  return normalized;
}

function normalizeNullableText(value: string | null, name: string, max: number): string | null {
  if (value === null) return null;
  return boundedText(value, name, max);
}

function normalizedPresentation(value: ConversationResponsePresentation): ConversationResponsePresentation {
  return {
    opening: boundedText(value.opening, "Conversation opening", MAX_FRAME_CHARS),
    composerBody: normalizeNullableText(value.composerBody, "Conversation Composer body", MAX_COMPOSER_CHARS),
    closing: normalizeNullableText(value.closing, "Conversation closing", MAX_FRAME_CHARS),
  };
}

function presentationText(value: ConversationResponsePresentation): string {
  return [value.opening, value.composerBody, value.closing]
    .filter((part): part is string => part !== null)
    .join("\n\n");
}

function normalizedResponse(response: ConversationResponse): ConversationResponse {
  const content = boundedText(response.content, "Conversation response content", MAX_CONTENT_CHARS);
  const presentation = response.presentation === undefined
    ? undefined
    : normalizedPresentation(response.presentation);
  if (presentation && presentationText(presentation) !== content) {
    throw new Error("Conversation response presentation must faithfully compose the persisted response content.");
  }
  if (response.origin !== "SOLANDRA") throw new Error("Conversation response origin must be SOLANDRA.");
  if (response.authority !== "NON_AUTHORITATIVE_CONVERSATION" || response.factualAuthority !== false) {
    throw new Error("Conversation response cannot carry Product factual authority.");
  }
  const createdAt = new Date(response.createdAt);
  if (Number.isNaN(createdAt.valueOf())) throw new Error("Conversation response timestamp is invalid.");
  return {
    responseId: boundedId(response.responseId, "Conversation response id"),
    conversationId: boundedId(response.conversationId, "Conversation id"),
    sourceMessageId: boundedId(response.sourceMessageId, "Conversation response source message id"),
    content,
    ...(presentation ? { presentation } : {}),
    origin: "SOLANDRA",
    authority: "NON_AUTHORITATIVE_CONVERSATION",
    factualAuthority: false,
    createdAt: createdAt.toISOString(),
  };
}

function sameResponse(left: ConversationResponse, right: ConversationResponse): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class MemoryConversationResponseStore implements ConversationResponseStore {
  readonly kind = "memory" as const;
  private readonly responses = new Map<string, ConversationResponse>();

  async putResponse(response: ConversationResponse): Promise<ConversationResponse> {
    const normalized = normalizedResponse(response);
    const existing = this.responses.get(normalized.responseId);
    if (existing) {
      if (!sameResponse(existing, normalized)) throw new Error("Conversation response id collision.");
      return structuredClone(existing);
    }
    const sameTurn = [...this.responses.values()].find((item) =>
      item.conversationId === normalized.conversationId && item.sourceMessageId === normalized.sourceMessageId);
    if (sameTurn) {
      if (!sameResponse(sameTurn, normalized)) throw new Error("Conversation response source-message collision.");
      return structuredClone(sameTurn);
    }
    this.responses.set(normalized.responseId, structuredClone(normalized));
    return structuredClone(normalized);
  }

  async getResponse(responseId: string): Promise<ConversationResponse | undefined> {
    const response = this.responses.get(boundedId(responseId, "Conversation response id"));
    return response ? structuredClone(response) : undefined;
  }

  async listByConversation(conversationId: string): Promise<ConversationResponse[]> {
    const id = boundedId(conversationId, "Conversation id");
    return [...this.responses.values()]
      .filter((response) => response.conversationId === id)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.responseId.localeCompare(right.responseId))
      .map((response) => structuredClone(response));
  }

  async close(): Promise<void> { this.responses.clear(); }
}

type ConversationResponseRow = {
  response_id: string;
  conversation_id: string;
  source_message_id: string;
  content: string;
  presentation: unknown | null;
  origin: string;
  authority: string;
  factual_authority: boolean;
  created_at: Date | string;
};

function presentationFromRow(value: unknown): ConversationResponsePresentation | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Persisted conversation response presentation is invalid.");
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.opening !== "string"
    || !(typeof record.composerBody === "string" || record.composerBody === null)
    || !(typeof record.closing === "string" || record.closing === null)
  ) {
    throw new Error("Persisted conversation response presentation is invalid.");
  }
  return normalizedPresentation({
    opening: record.opening,
    composerBody: record.composerBody,
    closing: record.closing,
  });
}

function fromRow(row: ConversationResponseRow): ConversationResponse {
  if (row.origin !== "SOLANDRA") throw new Error("Persisted conversation response origin is invalid.");
  if (row.authority !== "NON_AUTHORITATIVE_CONVERSATION" || row.factual_authority !== false) {
    throw new Error("Persisted conversation response authority is invalid.");
  }
  const presentation = presentationFromRow(row.presentation);
  return normalizedResponse({
    responseId: row.response_id,
    conversationId: row.conversation_id,
    sourceMessageId: row.source_message_id,
    content: row.content,
    ...(presentation ? { presentation } : {}),
    origin: row.origin,
    authority: row.authority,
    factualAuthority: row.factual_authority,
    createdAt: new Date(row.created_at).toISOString(),
  });
}

export class PostgresConversationResponseStore implements ConversationResponseStore {
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

  static async connect(databaseUrl: string, options: { migrate?: boolean } = {}): Promise<PostgresConversationResponseStore> {
    if (options.migrate) await PostgresConversationResponseStore.migrate(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl });
    const ready = await pool.query<{ name: string }>(
      "SELECT name FROM schema_migrations WHERE name = ANY($1::text[])",
      [migrations],
    );
    const applied = new Set(ready.rows.map((row) => row.name));
    const missing = migrations.find((migration) => !applied.has(migration));
    if (missing) {
      await pool.end();
      throw new Error(`Conversation response schema is not ready; required migration ${missing} is missing.`);
    }
    return new PostgresConversationResponseStore(pool);
  }

  async putResponse(response: ConversationResponse): Promise<ConversationResponse> {
    const normalized = normalizedResponse(response);
    const inserted = await this.pool.query<ConversationResponseRow>(
      `INSERT INTO conversation_responses(
         response_id, conversation_id, source_message_id, content, presentation, origin, authority, factual_authority, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (response_id) DO NOTHING
       RETURNING response_id, conversation_id, source_message_id, content, presentation, origin, authority, factual_authority, created_at`,
      [
        normalized.responseId,
        normalized.conversationId,
        normalized.sourceMessageId,
        normalized.content,
        normalized.presentation === undefined ? null : normalized.presentation,
        normalized.origin,
        normalized.authority,
        normalized.factualAuthority,
        normalized.createdAt,
      ],
    );
    if (inserted.rows[0]) return fromRow(inserted.rows[0]);
    const existing = await this.getResponse(normalized.responseId);
    if (existing && sameResponse(existing, normalized)) return existing;
    const sameTurn = await this.pool.query<ConversationResponseRow>(
      `SELECT response_id, conversation_id, source_message_id, content, presentation, origin, authority, factual_authority, created_at
       FROM conversation_responses WHERE conversation_id=$1 AND source_message_id=$2`,
      [normalized.conversationId, normalized.sourceMessageId],
    );
    const collided = sameTurn.rows[0] ? fromRow(sameTurn.rows[0]) : undefined;
    if (collided && sameResponse(collided, normalized)) return collided;
    throw new Error("Conversation response persistence conflict.");
  }

  async getResponse(responseId: string): Promise<ConversationResponse | undefined> {
    const result = await this.pool.query<ConversationResponseRow>(
      `SELECT response_id, conversation_id, source_message_id, content, presentation, origin, authority, factual_authority, created_at
       FROM conversation_responses WHERE response_id=$1`,
      [boundedId(responseId, "Conversation response id")],
    );
    return result.rows[0] ? fromRow(result.rows[0]) : undefined;
  }

  async listByConversation(conversationId: string): Promise<ConversationResponse[]> {
    const result = await this.pool.query<ConversationResponseRow>(
      `SELECT response_id, conversation_id, source_message_id, content, presentation, origin, authority, factual_authority, created_at
       FROM conversation_responses
       WHERE conversation_id=$1
       ORDER BY created_at ASC, response_id ASC`,
      [boundedId(conversationId, "Conversation id")],
    );
    return result.rows.map(fromRow);
  }

  async close(): Promise<void> { await this.pool.end(); }
}
