import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import type { PreparedResource, PreparedResourceBasis } from "../outcome.js";

const migration = "035_prepared_resources.sql" as const;

export interface PreparedResourceRecord {
  resourceId: string;
  conversationId: string;
  runId: string;
  intentScopeId: string;
  intentVersionId: string;
  sourceMessageId: string;
  kind: "PREPARED_MESSAGE";
  title: string;
  body: string;
  basis: PreparedResourceBasis[];
  knowledgeIds: string[];
  claimIds: string[];
  preservedUncertainties: string[];
  editable: true;
  executionAuthorized: false;
  createdAt: string;
}

export interface PreparedResourceStore {
  readonly kind: "memory" | "postgres";
  putPreparedResource(record: PreparedResourceRecord): Promise<PreparedResourceRecord>;
  getPreparedResource(resourceId: string): Promise<PreparedResourceRecord | undefined>;
  getPreparedResourceByRunId(runId: string): Promise<PreparedResourceRecord | undefined>;
  close(): Promise<void>;
}

function stableId(prefix: string, ...parts: string[]): string {
  const digest = createHash("sha256").update(parts.join("\u001f")).digest("hex");
  return `${prefix}_${digest.slice(0, 40)}`;
}

function bounded(value: string, label: string, max = 8_000): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new Error(`${label} must contain between 1 and ${max} non-whitespace characters.`);
  }
  return normalized;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`Persisted ${label} is invalid.`);
  }
  return [...value];
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function normalizeBasis(basis: readonly PreparedResourceBasis[]): PreparedResourceBasis[] {
  const byKnowledge = new Map<string, Set<string>>();
  for (const entry of basis) {
    const knowledgeId = bounded(entry.knowledgeId, "basis knowledgeId", 128);
    if (entry.claimIds.length === 0) {
      throw new Error("A PreparedResource Knowledge basis entry requires at least one exact claim reference.");
    }
    const claims = byKnowledge.get(knowledgeId) ?? new Set<string>();
    for (const claimId of entry.claimIds) claims.add(bounded(claimId, "basis claimId", 300));
    byKnowledge.set(knowledgeId, claims);
  }
  return [...byKnowledge.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([knowledgeId, claimIds]) => ({ knowledgeId, claimIds: [...claimIds].sort() }));
}

function dateOrThrow(value: string, label: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error(`${label} must be an ISO-compatible date.`);
  return date.toISOString();
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function sameRecord(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function buildPreparedResourceRecord(
  input: Omit<PreparedResourceRecord, "resourceId" | "knowledgeIds" | "claimIds" | "editable" | "executionAuthorized">,
): PreparedResourceRecord {
  const runId = bounded(input.runId, "runId", 200);
  const intentVersionId = bounded(input.intentVersionId, "intentVersionId", 200);
  const sourceMessageId = bounded(input.sourceMessageId, "sourceMessageId", 200);
  const basis = normalizeBasis(input.basis);
  return Object.freeze({
    resourceId: stableId("prepared_resource", runId, intentVersionId, sourceMessageId),
    conversationId: bounded(input.conversationId, "conversationId", 128),
    runId,
    intentScopeId: bounded(input.intentScopeId, "intentScopeId", 200),
    intentVersionId,
    sourceMessageId,
    kind: "PREPARED_MESSAGE",
    title: bounded(input.title, "title", 300),
    body: bounded(input.body, "body", 8_000),
    basis,
    knowledgeIds: basis.map((entry) => entry.knowledgeId),
    claimIds: unique(basis.flatMap((entry) => entry.claimIds)),
    preservedUncertainties: unique(input.preservedUncertainties.map((item) => bounded(item, "preserved uncertainty", 2_000))),
    editable: true,
    executionAuthorized: false,
    createdAt: dateOrThrow(input.createdAt, "createdAt"),
  });
}

export function preparedResourceFromRecord(record: PreparedResourceRecord): PreparedResource {
  return {
    kind: record.kind,
    title: record.title,
    body: record.body,
    editable: true,
    executionAuthorized: false,
    basis: clone(record.basis),
    preservedUncertainties: [...record.preservedUncertainties],
  };
}

export class MemoryPreparedResourceStore implements PreparedResourceStore {
  readonly kind = "memory" as const;
  private readonly records = new Map<string, PreparedResourceRecord>();
  private readonly byRun = new Map<string, string>();

  async putPreparedResource(record: PreparedResourceRecord): Promise<PreparedResourceRecord> {
    const existing = this.records.get(record.resourceId);
    if (existing) {
      if (!sameRecord(existing, record)) throw new Error("PreparedResource identity cannot be rebound to different state.");
      return clone(existing);
    }
    const runResource = this.byRun.get(record.runId);
    if (runResource && runResource !== record.resourceId) {
      throw new Error("A completed preparation Run cannot establish multiple PreparedResource identities.");
    }
    this.records.set(record.resourceId, clone(record));
    this.byRun.set(record.runId, record.resourceId);
    return clone(record);
  }

  async getPreparedResource(resourceId: string): Promise<PreparedResourceRecord | undefined> {
    const value = this.records.get(resourceId);
    return value ? clone(value) : undefined;
  }

  async getPreparedResourceByRunId(runId: string): Promise<PreparedResourceRecord | undefined> {
    const id = this.byRun.get(runId);
    return id ? await this.getPreparedResource(id) : undefined;
  }

  async close(): Promise<void> {
    this.records.clear();
    this.byRun.clear();
  }
}

type PreparedResourceRow = {
  resource_id: string;
  conversation_id: string;
  run_id: string;
  intent_scope_id: string;
  intent_version_id: string;
  source_message_id: string;
  resource_kind: string;
  title: string;
  body: string;
  basis: unknown;
  knowledge_ids: unknown;
  claim_ids: unknown;
  preserved_uncertainties: unknown;
  editable: boolean;
  execution_authorized: boolean;
  created_at: Date | string;
};

function persistedBasis(value: unknown): PreparedResourceBasis[] {
  if (!Array.isArray(value)) throw new Error("Persisted PreparedResource basis is invalid.");
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Persisted PreparedResource basis entry is invalid.");
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.knowledgeId !== "string") throw new Error("Persisted PreparedResource Knowledge ID is invalid.");
    return { knowledgeId: record.knowledgeId, claimIds: stringArray(record.claimIds, "PreparedResource basis claim IDs") };
  });
}

function mapRow(row: PreparedResourceRow): PreparedResourceRecord {
  if (row.resource_kind !== "PREPARED_MESSAGE") throw new Error("Persisted PreparedResource kind is unsupported.");
  if (row.editable !== true) throw new Error("Persisted PreparedResource must remain editable.");
  if (row.execution_authorized !== false) throw new Error("Persisted PreparedResource cannot authorize execution.");
  return {
    resourceId: row.resource_id,
    conversationId: row.conversation_id,
    runId: row.run_id,
    intentScopeId: row.intent_scope_id,
    intentVersionId: row.intent_version_id,
    sourceMessageId: row.source_message_id,
    kind: "PREPARED_MESSAGE",
    title: row.title,
    body: row.body,
    basis: persistedBasis(row.basis),
    knowledgeIds: stringArray(row.knowledge_ids, "PreparedResource knowledge IDs"),
    claimIds: stringArray(row.claim_ids, "PreparedResource claim IDs"),
    preservedUncertainties: stringArray(row.preserved_uncertainties, "PreparedResource preserved uncertainties"),
    editable: true,
    executionAuthorized: false,
    createdAt: dateOrThrow(row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at, "created_at"),
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
  if (result.rows[0]?.count !== "1") throw new Error(`PreparedResource schema is not ready; required migration ${migration} is missing.`);
}

const columns = "resource_id,conversation_id,run_id,intent_scope_id,intent_version_id,source_message_id,resource_kind,title,body,basis,knowledge_ids,claim_ids,preserved_uncertainties,editable,execution_authorized,created_at";

export class PostgresPreparedResourceStore implements PreparedResourceStore {
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

  static async connect(databaseUrl: string): Promise<PostgresPreparedResourceStore> {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query("SELECT 1");
      await assertReady(pool);
      return new PostgresPreparedResourceStore(pool);
    } catch (error) {
      await pool.end();
      throw error;
    }
  }

  async putPreparedResource(record: PreparedResourceRecord): Promise<PreparedResourceRecord> {
    const result = await this.pool.query<PreparedResourceRow>(
      `INSERT INTO prepared_resources(${columns})
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14,$15,$16)
       ON CONFLICT(resource_id) DO NOTHING
       RETURNING ${columns}`,
      [
        record.resourceId,
        record.conversationId,
        record.runId,
        record.intentScopeId,
        record.intentVersionId,
        record.sourceMessageId,
        record.kind,
        record.title,
        record.body,
        JSON.stringify(record.basis),
        JSON.stringify(record.knowledgeIds),
        JSON.stringify(record.claimIds),
        JSON.stringify(record.preservedUncertainties),
        true,
        false,
        record.createdAt,
      ],
    );
    if ((result.rowCount ?? 0) > 0) return mapRow(result.rows[0]!);
    const existing = await this.getPreparedResource(record.resourceId);
    if (!existing) throw new Error("PreparedResource insert lost its persisted identity.");
    if (!sameRecord(existing, record)) throw new Error("PreparedResource identity cannot be rebound to different state.");
    return existing;
  }

  async getPreparedResource(resourceId: string): Promise<PreparedResourceRecord | undefined> {
    const result = await this.pool.query<PreparedResourceRow>(`SELECT ${columns} FROM prepared_resources WHERE resource_id=$1`, [resourceId]);
    return result.rows[0] ? mapRow(result.rows[0]) : undefined;
  }

  async getPreparedResourceByRunId(runId: string): Promise<PreparedResourceRecord | undefined> {
    const result = await this.pool.query<PreparedResourceRow>(`SELECT ${columns} FROM prepared_resources WHERE run_id=$1`, [runId]);
    return result.rows[0] ? mapRow(result.rows[0]) : undefined;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
