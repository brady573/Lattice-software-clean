import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";

const migration = "037_m4_general_decision_journey.sql" as const;

export interface AcceptedChoiceRecord {
  acceptedChoiceId: string;
  conversationId: string;
  intentScopeId: string;
  intentVersionId: string;
  recommendationId: string;
  optionId: string;
  optionText: string;
  sourceMessageId: string;
  sourceMessageDigest: string;
  authorizationGranted: false;
  executionAuthorized: false;
  createdAt: string;
}

export interface AcceptedChoiceStore {
  readonly kind: "memory" | "postgres";
  putAcceptedChoice(record: AcceptedChoiceRecord): Promise<AcceptedChoiceRecord>;
  getAcceptedChoice(acceptedChoiceId: string): Promise<AcceptedChoiceRecord | undefined>;
  listAcceptedChoicesByConversation(conversationId: string): Promise<AcceptedChoiceRecord[]>;
  close(): Promise<void>;
}

function bounded(value: string, label: string, max = 8_000): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new Error(`${label} must contain between 1 and ${max} non-whitespace characters.`);
  }
  return normalized;
}

function iso(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error("AcceptedChoice createdAt must be an ISO-compatible date.");
  return date.toISOString();
}

function clone<T>(value: T): T { return structuredClone(value); }
function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }

export function buildAcceptedChoiceRecord(input: Omit<AcceptedChoiceRecord, "acceptedChoiceId" | "authorizationGranted" | "executionAuthorized">): AcceptedChoiceRecord {
  const conversationId = bounded(input.conversationId, "conversationId", 128);
  const intentScopeId = bounded(input.intentScopeId, "intentScopeId", 200);
  const intentVersionId = bounded(input.intentVersionId, "intentVersionId", 200);
  const recommendationId = bounded(input.recommendationId, "recommendationId", 128);
  const optionId = bounded(input.optionId, "optionId", 128);
  const optionText = bounded(input.optionText, "optionText", 2_000);
  const sourceMessageId = bounded(input.sourceMessageId, "sourceMessageId", 200);
  const sourceMessageDigest = bounded(input.sourceMessageDigest, "sourceMessageDigest", 200);
  const acceptedChoiceId = `accepted_choice_${createHash("sha256")
    .update([conversationId, intentVersionId, recommendationId, optionId, sourceMessageId].join("\u001f"))
    .digest("hex").slice(0, 40)}`;
  return Object.freeze({
    acceptedChoiceId,
    conversationId,
    intentScopeId,
    intentVersionId,
    recommendationId,
    optionId,
    optionText,
    sourceMessageId,
    sourceMessageDigest,
    authorizationGranted: false,
    executionAuthorized: false,
    createdAt: iso(input.createdAt),
  });
}

export class MemoryAcceptedChoiceStore implements AcceptedChoiceStore {
  readonly kind = "memory" as const;
  private readonly records = new Map<string, AcceptedChoiceRecord>();
  private readonly bySourceMessage = new Map<string, string>();

  async putAcceptedChoice(record: AcceptedChoiceRecord): Promise<AcceptedChoiceRecord> {
    const existing = this.records.get(record.acceptedChoiceId);
    if (existing) {
      if (!same(existing, record)) throw new Error("AcceptedChoice identity cannot be rebound.");
      return clone(existing);
    }
    const priorId = this.bySourceMessage.get(record.sourceMessageId);
    if (priorId && priorId !== record.acceptedChoiceId) {
      throw new Error("One USER source message cannot establish conflicting AcceptedChoice identities.");
    }
    this.records.set(record.acceptedChoiceId, clone(record));
    this.bySourceMessage.set(record.sourceMessageId, record.acceptedChoiceId);
    return clone(record);
  }

  async getAcceptedChoice(acceptedChoiceId: string): Promise<AcceptedChoiceRecord | undefined> {
    const record = this.records.get(acceptedChoiceId);
    return record ? clone(record) : undefined;
  }

  async listAcceptedChoicesByConversation(conversationId: string): Promise<AcceptedChoiceRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.conversationId === conversationId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.acceptedChoiceId.localeCompare(b.acceptedChoiceId))
      .map(clone);
  }

  async close(): Promise<void> {
    this.records.clear();
    this.bySourceMessage.clear();
  }
}

type ChoiceRow = {
  accepted_choice_id: string;
  conversation_id: string;
  intent_scope_id: string;
  intent_version_id: string;
  recommendation_id: string;
  option_id: string;
  option_text: string;
  source_message_id: string;
  source_message_digest: string;
  authorization_granted: boolean;
  execution_authorized: boolean;
  created_at: Date | string;
};

function mapRow(row: ChoiceRow): AcceptedChoiceRecord {
  if (row.authorization_granted !== false || row.execution_authorized !== false) {
    throw new Error("Persisted AcceptedChoice cannot contain action authorization.");
  }
  return {
    acceptedChoiceId: row.accepted_choice_id,
    conversationId: row.conversation_id,
    intentScopeId: row.intent_scope_id,
    intentVersionId: row.intent_version_id,
    recommendationId: row.recommendation_id,
    optionId: row.option_id,
    optionText: row.option_text,
    sourceMessageId: row.source_message_id,
    sourceMessageDigest: row.source_message_digest,
    authorizationGranted: false,
    executionAuthorized: false,
    createdAt: iso(row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at),
  };
}

async function applyMigration(pool: Pool): Promise<void> {
  await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const existing = await pool.query<{ name: string }>("SELECT name FROM schema_migrations WHERE name=$1", [migration]);
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
}

async function assertReady(pool: Pool): Promise<void> {
  const result = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM schema_migrations WHERE name=$1", [migration]);
  if (result.rows[0]?.count !== "1") throw new Error(`AcceptedChoice schema is not ready; required migration ${migration} is missing.`);
}

const columns = "accepted_choice_id,conversation_id,intent_scope_id,intent_version_id,recommendation_id,option_id,option_text,source_message_id,source_message_digest,authorization_granted,execution_authorized,created_at";

export class PostgresAcceptedChoiceStore implements AcceptedChoiceStore {
  readonly kind = "postgres" as const;
  private constructor(private readonly pool: Pool) {}

  static async migrate(databaseUrl: string): Promise<void> {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query("SELECT 1");
      await applyMigration(pool);
      await assertReady(pool);
    } finally {
      await pool.end();
    }
  }

  static async connect(databaseUrl: string): Promise<PostgresAcceptedChoiceStore> {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query("SELECT 1");
      await assertReady(pool);
      return new PostgresAcceptedChoiceStore(pool);
    } catch (error) {
      await pool.end();
      throw error;
    }
  }

  async putAcceptedChoice(record: AcceptedChoiceRecord): Promise<AcceptedChoiceRecord> {
    const result = await this.pool.query<ChoiceRow>(
      `INSERT INTO accepted_choices(${columns}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT(accepted_choice_id) DO NOTHING RETURNING ${columns}`,
      [record.acceptedChoiceId, record.conversationId, record.intentScopeId, record.intentVersionId,
       record.recommendationId, record.optionId, record.optionText, record.sourceMessageId,
       record.sourceMessageDigest, false, false, record.createdAt],
    );
    if ((result.rowCount ?? 0) > 0) return mapRow(result.rows[0]!);
    const existing = await this.getAcceptedChoice(record.acceptedChoiceId);
    if (!existing || !same(existing, record)) throw new Error("AcceptedChoice identity cannot be rebound.");
    return existing;
  }

  async getAcceptedChoice(acceptedChoiceId: string): Promise<AcceptedChoiceRecord | undefined> {
    const result = await this.pool.query<ChoiceRow>(`SELECT ${columns} FROM accepted_choices WHERE accepted_choice_id=$1`, [acceptedChoiceId]);
    return result.rows[0] ? mapRow(result.rows[0]) : undefined;
  }

  async listAcceptedChoicesByConversation(conversationId: string): Promise<AcceptedChoiceRecord[]> {
    const result = await this.pool.query<ChoiceRow>(
      `SELECT ${columns} FROM accepted_choices WHERE conversation_id=$1 ORDER BY created_at,accepted_choice_id`,
      [conversationId],
    );
    return result.rows.map(mapRow);
  }

  async close(): Promise<void> { await this.pool.end(); }
}
