import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";

const migration = "040_conversation_references.sql" as const;
const MAX_TARGETS = 32;

export type ConversationReferenceTargetKind =
  | "KNOWLEDGE"
  | "RECOMMENDATION"
  | "OPTION"
  | "ACCEPTED_CHOICE"
  | "PREPARED_RESOURCE";

export type ConversationReferenceRelation = "CONSUMED" | "PRODUCED";

export interface ConversationReferenceTarget {
  kind: ConversationReferenceTargetKind;
  targetId: string;
  relation: ConversationReferenceRelation;
}

export interface ConversationReferenceRecord {
  referenceId: string;
  conversationId: string;
  userMessageId: string;
  responseId: string;
  intentVersionId: string;
  targets: ConversationReferenceTarget[];
  parentReferenceId: string | null;
  createdAt: string;
}

export interface ConversationReferenceStore {
  readonly kind: "memory" | "postgres";
  putReference(reference: ConversationReferenceRecord): Promise<ConversationReferenceRecord>;
  getReference(referenceId: string): Promise<ConversationReferenceRecord | undefined>;
  listByConversation(conversationId: string): Promise<ConversationReferenceRecord[]>;
  latestReference(conversationId: string): Promise<ConversationReferenceRecord | undefined>;
  close(): Promise<void>;
}

function stableId(prefix: string, ...parts: string[]): string {
  const digest = createHash("sha256").update(parts.join("\u001f")).digest("hex");
  return `${prefix}_${digest.slice(0, 40)}`;
}

function bounded(value: string, label: string, max = 256): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new Error(`${label} must contain between 1 and ${max} non-whitespace characters.`);
  }
  return normalized;
}

function iso(value: string, label: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error(`${label} must be an ISO-compatible date.`);
  return date.toISOString();
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function targetKey(target: ConversationReferenceTarget): string {
  return `${target.kind}:${target.relation}:${target.targetId}`;
}

function normalizeTargets(targets: readonly ConversationReferenceTarget[]): ConversationReferenceTarget[] {
  if (!Array.isArray(targets) || targets.length === 0 || targets.length > MAX_TARGETS) {
    throw new Error(`ConversationReference requires between 1 and ${MAX_TARGETS} governed targets.`);
  }
  const validKinds = new Set<ConversationReferenceTargetKind>([
    "KNOWLEDGE",
    "RECOMMENDATION",
    "OPTION",
    "ACCEPTED_CHOICE",
    "PREPARED_RESOURCE",
  ]);
  const validRelations = new Set<ConversationReferenceRelation>(["CONSUMED", "PRODUCED"]);
  const normalized = targets.map((target) => {
    if (!validKinds.has(target.kind)) throw new Error("ConversationReference target kind is invalid.");
    if (!validRelations.has(target.relation)) throw new Error("ConversationReference target relation is invalid.");
    return {
      kind: target.kind,
      targetId: bounded(target.targetId, "ConversationReference targetId", 256),
      relation: target.relation,
    };
  });
  const byKey = new Map(normalized.map((target) => [targetKey(target), target] as const));
  return [...byKey.values()].sort((left, right) => targetKey(left).localeCompare(targetKey(right)));
}

export function buildConversationReference(input: {
  conversationId: string;
  userMessageId: string;
  responseId: string;
  intentVersionId: string;
  targets: readonly ConversationReferenceTarget[];
  parentReferenceId?: string | null;
  createdAt: string;
}): ConversationReferenceRecord {
  const conversationId = bounded(input.conversationId, "ConversationReference conversationId", 128);
  const userMessageId = bounded(input.userMessageId, "ConversationReference userMessageId", 200);
  const responseId = bounded(input.responseId, "ConversationReference responseId", 256);
  const intentVersionId = bounded(input.intentVersionId, "ConversationReference intentVersionId", 200);
  const targets = normalizeTargets(input.targets);
  const parentReferenceId = input.parentReferenceId === undefined || input.parentReferenceId === null
    ? null
    : bounded(input.parentReferenceId, "ConversationReference parentReferenceId", 128);
  const createdAt = iso(input.createdAt, "ConversationReference createdAt");
  return Object.freeze({
    referenceId: stableId(
      "conversation_reference",
      conversationId,
      userMessageId,
      responseId,
      intentVersionId,
      ...targets.map(targetKey),
    ),
    conversationId,
    userMessageId,
    responseId,
    intentVersionId,
    targets,
    parentReferenceId,
    createdAt,
  });
}

export async function appendConversationReference(
  store: ConversationReferenceStore,
  input: Omit<Parameters<typeof buildConversationReference>[0], "parentReferenceId">,
): Promise<ConversationReferenceRecord> {
  const identity = buildConversationReference({ ...input, parentReferenceId: null });
  const existing = await store.getReference(identity.referenceId);
  if (existing) return existing;
  const latest = await store.latestReference(input.conversationId);
  return store.putReference(buildConversationReference({
    ...input,
    parentReferenceId: latest?.referenceId ?? null,
  }));
}

export class MemoryConversationReferenceStore implements ConversationReferenceStore {
  readonly kind = "memory" as const;
  private readonly references = new Map<string, ConversationReferenceRecord>();

  async putReference(reference: ConversationReferenceRecord): Promise<ConversationReferenceRecord> {
    const normalized = buildConversationReference(reference);
    const existing = this.references.get(normalized.referenceId);
    if (existing) {
      if (!same(existing, normalized)) throw new Error("ConversationReference identity cannot be rebound.");
      return clone(existing);
    }
    if (normalized.parentReferenceId !== null && !this.references.has(normalized.parentReferenceId)) {
      throw new Error("ConversationReference parent must already exist.");
    }
    this.references.set(normalized.referenceId, clone(normalized));
    return clone(normalized);
  }

  async getReference(referenceId: string): Promise<ConversationReferenceRecord | undefined> {
    const reference = this.references.get(referenceId);
    return reference ? clone(reference) : undefined;
  }

  async listByConversation(conversationId: string): Promise<ConversationReferenceRecord[]> {
    return [...this.references.values()]
      .filter((reference) => reference.conversationId === conversationId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.referenceId.localeCompare(right.referenceId))
      .map(clone);
  }

  async latestReference(conversationId: string): Promise<ConversationReferenceRecord | undefined> {
    return (await this.listByConversation(conversationId)).at(-1);
  }

  async close(): Promise<void> {
    this.references.clear();
  }
}

type ReferenceRow = {
  reference_id: string;
  conversation_id: string;
  user_message_id: string;
  response_id: string;
  intent_version_id: string;
  targets: unknown;
  parent_reference_id: string | null;
  created_at: Date | string;
};

function persistedTargets(value: unknown): ConversationReferenceTarget[] {
  if (!Array.isArray(value)) throw new Error("Persisted ConversationReference targets are invalid.");
  return normalizeTargets(value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Persisted ConversationReference target is invalid.");
    }
    const record = item as Record<string, unknown>;
    if (typeof record.kind !== "string" || typeof record.targetId !== "string" || typeof record.relation !== "string") {
      throw new Error("Persisted ConversationReference target fields are invalid.");
    }
    return {
      kind: record.kind as ConversationReferenceTargetKind,
      targetId: record.targetId,
      relation: record.relation as ConversationReferenceRelation,
    };
  }));
}

function mapRow(row: ReferenceRow): ConversationReferenceRecord {
  const mapped = buildConversationReference({
    conversationId: row.conversation_id,
    userMessageId: row.user_message_id,
    responseId: row.response_id,
    intentVersionId: row.intent_version_id,
    targets: persistedTargets(row.targets),
    parentReferenceId: row.parent_reference_id,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  });
  if (mapped.referenceId !== row.reference_id) {
    throw new Error("Persisted ConversationReference identity does not match its exact governed binding.");
  }
  return mapped;
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
  const result = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM schema_migrations WHERE name=$1",
    [migration],
  );
  if (result.rows[0]?.count !== "1") {
    throw new Error(`ConversationReference schema is not ready; required migration ${migration} is missing.`);
  }
}

const columns = "reference_id,conversation_id,user_message_id,response_id,intent_version_id,targets,parent_reference_id,created_at";

export class PostgresConversationReferenceStore implements ConversationReferenceStore {
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

  static async connect(databaseUrl: string): Promise<PostgresConversationReferenceStore> {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query("SELECT 1");
      await assertReady(pool);
      return new PostgresConversationReferenceStore(pool);
    } catch (error) {
      await pool.end();
      throw error;
    }
  }

  async putReference(reference: ConversationReferenceRecord): Promise<ConversationReferenceRecord> {
    const normalized = buildConversationReference(reference);
    if (normalized.parentReferenceId !== null) {
      const parent = await this.getReference(normalized.parentReferenceId);
      if (!parent || parent.conversationId !== normalized.conversationId) {
        throw new Error("ConversationReference parent must exist in the same conversation.");
      }
    }
    const result = await this.pool.query<ReferenceRow>(
      `INSERT INTO conversation_references(${columns}) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
       ON CONFLICT(reference_id) DO NOTHING RETURNING ${columns}`,
      [
        normalized.referenceId,
        normalized.conversationId,
        normalized.userMessageId,
        normalized.responseId,
        normalized.intentVersionId,
        JSON.stringify(normalized.targets),
        normalized.parentReferenceId,
        normalized.createdAt,
      ],
    );
    if ((result.rowCount ?? 0) > 0) return mapRow(result.rows[0]!);
    const existing = await this.getReference(normalized.referenceId);
    if (!existing || !same(existing, normalized)) throw new Error("ConversationReference identity cannot be rebound.");
    return existing;
  }

  async getReference(referenceId: string): Promise<ConversationReferenceRecord | undefined> {
    const result = await this.pool.query<ReferenceRow>(
      `SELECT ${columns} FROM conversation_references WHERE reference_id=$1`,
      [referenceId],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : undefined;
  }

  async listByConversation(conversationId: string): Promise<ConversationReferenceRecord[]> {
    const result = await this.pool.query<ReferenceRow>(
      `SELECT ${columns} FROM conversation_references WHERE conversation_id=$1 ORDER BY created_at, reference_id`,
      [conversationId],
    );
    return result.rows.map(mapRow);
  }

  async latestReference(conversationId: string): Promise<ConversationReferenceRecord | undefined> {
    const result = await this.pool.query<ReferenceRow>(
      `SELECT ${columns} FROM conversation_references WHERE conversation_id=$1 ORDER BY created_at DESC, reference_id DESC LIMIT 1`,
      [conversationId],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : undefined;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
