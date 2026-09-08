import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";

const migration = "034_recommendations.sql" as const;

export interface RecommendationBasis {
  knowledgeId: string;
  claimIds: string[];
}

export interface RecommendationRecord {
  recommendationId: string;
  conversationId: string;
  runId: string;
  intentScopeId: string;
  intentVersionId: string;
  sourceMessageId: string;
  basis: RecommendationBasis[];
  knowledgeIds: string[];
  claimIds: string[];
  recommendation: string;
  rationale: string[];
  tradeoffs: string[];
  assumptions: string[];
  uncertainties: string[];
  alternatives: string[];
  selectionAuthorized: false;
  createdAt: string;
}

export interface RecommendationStore {
  readonly kind: "memory" | "postgres";
  putRecommendation(record: RecommendationRecord): Promise<RecommendationRecord>;
  getRecommendation(recommendationId: string): Promise<RecommendationRecord | undefined>;
  getRecommendationByRunId(runId: string): Promise<RecommendationRecord | undefined>;
  listRecommendationsByConversation(conversationId: string): Promise<RecommendationRecord[]>;
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

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function dateOrThrow(value: string, label: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error(`${label} must be an ISO-compatible date.`);
  return date.toISOString();
}

function sameRecord(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function buildRecommendationRecord(
  input: Omit<RecommendationRecord, "recommendationId" | "selectionAuthorized" | "knowledgeIds" | "claimIds">,
): RecommendationRecord {
  const conversationId = bounded(input.conversationId, "conversationId", 128);
  const runId = bounded(input.runId, "runId", 200);
  const intentScopeId = bounded(input.intentScopeId, "intentScopeId", 200);
  const intentVersionId = bounded(input.intentVersionId, "intentVersionId", 200);
  const sourceMessageId = bounded(input.sourceMessageId, "sourceMessageId", 200);
  const basis = input.basis.map((entry) => ({
    knowledgeId: bounded(entry.knowledgeId, "basis knowledgeId", 128),
    claimIds: unique(entry.claimIds),
  })).filter((entry) => entry.claimIds.length > 0);
  if (basis.length === 0) throw new Error("Recommendation requires at least one governed Knowledge/claim basis binding.");
  const basisByKnowledge = new Map<string, Set<string>>();
  for (const entry of basis) {
    const claims = basisByKnowledge.get(entry.knowledgeId) ?? new Set<string>();
    for (const claimId of entry.claimIds) claims.add(bounded(claimId, "basis claimId", 200));
    basisByKnowledge.set(entry.knowledgeId, claims);
  }
  const normalizedBasis = [...basisByKnowledge.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([knowledgeId, claimIds]) => ({ knowledgeId, claimIds: [...claimIds].sort() }));
  const knowledgeIds = normalizedBasis.map((entry) => entry.knowledgeId);
  const claimIds = unique(normalizedBasis.flatMap((entry) => entry.claimIds));
  const exactBasisIdentity = normalizedBasis.map((entry) => `${entry.knowledgeId}:${entry.claimIds.join(",")}`);
  return Object.freeze({
    recommendationId: stableId("recommendation", runId, intentVersionId, ...exactBasisIdentity),
    conversationId,
    runId,
    intentScopeId,
    intentVersionId,
    sourceMessageId,
    basis: normalizedBasis,
    knowledgeIds,
    claimIds,
    recommendation: bounded(input.recommendation, "recommendation"),
    rationale: input.rationale.map((item) => bounded(item, "rationale item", 2_000)),
    tradeoffs: input.tradeoffs.map((item) => bounded(item, "tradeoff", 2_000)),
    assumptions: input.assumptions.map((item) => bounded(item, "assumption", 2_000)),
    uncertainties: input.uncertainties.map((item) => bounded(item, "uncertainty", 2_000)),
    alternatives: input.alternatives.map((item) => bounded(item, "alternative", 2_000)),
    selectionAuthorized: false,
    createdAt: dateOrThrow(input.createdAt, "createdAt"),
  });
}

export class MemoryRecommendationStore implements RecommendationStore {
  readonly kind = "memory" as const;
  private readonly records = new Map<string, RecommendationRecord>();
  private readonly byRun = new Map<string, string>();

  async putRecommendation(record: RecommendationRecord): Promise<RecommendationRecord> {
    const existing = this.records.get(record.recommendationId);
    if (existing) {
      if (!sameRecord(existing, record)) throw new Error("Recommendation identity cannot be rebound to different advisory state.");
      return clone(existing);
    }
    const runRecommendation = this.byRun.get(record.runId);
    if (runRecommendation && runRecommendation !== record.recommendationId) {
      throw new Error("A completed advisory Run cannot establish multiple Recommendation identities.");
    }
    this.records.set(record.recommendationId, clone(record));
    this.byRun.set(record.runId, record.recommendationId);
    return clone(record);
  }

  async getRecommendation(recommendationId: string): Promise<RecommendationRecord | undefined> {
    const value = this.records.get(recommendationId);
    return value ? clone(value) : undefined;
  }

  async getRecommendationByRunId(runId: string): Promise<RecommendationRecord | undefined> {
    const id = this.byRun.get(runId);
    return id ? await this.getRecommendation(id) : undefined;
  }

  async listRecommendationsByConversation(conversationId: string): Promise<RecommendationRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.conversationId === conversationId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.recommendationId.localeCompare(right.recommendationId))
      .map(clone);
  }

  async close(): Promise<void> {
    this.records.clear();
    this.byRun.clear();
  }
}

type RecommendationRow = {
  recommendation_id: string;
  conversation_id: string;
  run_id: string;
  intent_scope_id: string;
  intent_version_id: string;
  source_message_id: string;
  basis: unknown;
  knowledge_ids: unknown;
  claim_ids: unknown;
  recommendation: string;
  rationale: unknown;
  tradeoffs: unknown;
  assumptions: unknown;
  uncertainties: unknown;
  alternatives: unknown;
  selection_authorized: boolean;
  created_at: Date | string;
};

function recommendationBasis(value: unknown): RecommendationBasis[] {
  if (!Array.isArray(value)) throw new Error("Persisted Recommendation basis is invalid.");
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Persisted Recommendation basis entry is invalid.");
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.knowledgeId !== "string") throw new Error("Persisted Recommendation basis knowledgeId is invalid.");
    return {
      knowledgeId: record.knowledgeId,
      claimIds: stringArray(record.claimIds, "basis claimIds"),
    };
  });
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`Persisted ${label} is invalid.`);
  }
  return [...value];
}

function mapRecommendation(row: RecommendationRow): RecommendationRecord {
  if (row.selection_authorized !== false) throw new Error("Persisted Recommendation cannot authorize selection.");
  return {
    recommendationId: row.recommendation_id,
    conversationId: row.conversation_id,
    runId: row.run_id,
    intentScopeId: row.intent_scope_id,
    intentVersionId: row.intent_version_id,
    sourceMessageId: row.source_message_id,
    basis: recommendationBasis(row.basis),
    knowledgeIds: stringArray(row.knowledge_ids, "knowledge_ids"),
    claimIds: stringArray(row.claim_ids, "claim_ids"),
    recommendation: row.recommendation,
    rationale: stringArray(row.rationale, "rationale"),
    tradeoffs: stringArray(row.tradeoffs, "tradeoffs"),
    assumptions: stringArray(row.assumptions, "assumptions"),
    uncertainties: stringArray(row.uncertainties, "uncertainties"),
    alternatives: stringArray(row.alternatives, "alternatives"),
    selectionAuthorized: false,
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
  if (result.rows[0]?.count !== "1") throw new Error(`Recommendation schema is not ready; required migration ${migration} is missing.`);
}

const columns = "recommendation_id,conversation_id,run_id,intent_scope_id,intent_version_id,source_message_id,basis,knowledge_ids,claim_ids,recommendation,rationale,tradeoffs,assumptions,uncertainties,alternatives,selection_authorized,created_at";

export class PostgresRecommendationStore implements RecommendationStore {
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

  static async connect(databaseUrl: string): Promise<PostgresRecommendationStore> {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query("SELECT 1");
      await assertReady(pool);
      return new PostgresRecommendationStore(pool);
    } catch (error) {
      await pool.end();
      throw error;
    }
  }

  async putRecommendation(record: RecommendationRecord): Promise<RecommendationRecord> {
    const result = await this.pool.query<RecommendationRow>(
      `INSERT INTO recommendations(${columns})
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16,$17)
       ON CONFLICT(recommendation_id) DO NOTHING
       RETURNING ${columns}`,
      [
        record.recommendationId,
        record.conversationId,
        record.runId,
        record.intentScopeId,
        record.intentVersionId,
        record.sourceMessageId,
        JSON.stringify(record.basis),
        JSON.stringify(record.knowledgeIds),
        JSON.stringify(record.claimIds),
        record.recommendation,
        JSON.stringify(record.rationale),
        JSON.stringify(record.tradeoffs),
        JSON.stringify(record.assumptions),
        JSON.stringify(record.uncertainties),
        JSON.stringify(record.alternatives),
        false,
        record.createdAt,
      ],
    );
    if ((result.rowCount ?? 0) > 0) return mapRecommendation(result.rows[0]!);
    const existing = await this.getRecommendation(record.recommendationId);
    if (!existing) throw new Error("Recommendation insert lost its persisted identity.");
    if (!sameRecord(existing, record)) throw new Error("Recommendation identity cannot be rebound to different advisory state.");
    return existing;
  }

  async getRecommendation(recommendationId: string): Promise<RecommendationRecord | undefined> {
    const result = await this.pool.query<RecommendationRow>(`SELECT ${columns} FROM recommendations WHERE recommendation_id=$1`, [recommendationId]);
    return result.rows[0] ? mapRecommendation(result.rows[0]) : undefined;
  }

  async getRecommendationByRunId(runId: string): Promise<RecommendationRecord | undefined> {
    const result = await this.pool.query<RecommendationRow>(`SELECT ${columns} FROM recommendations WHERE run_id=$1`, [runId]);
    return result.rows[0] ? mapRecommendation(result.rows[0]) : undefined;
  }

  async listRecommendationsByConversation(conversationId: string): Promise<RecommendationRecord[]> {
    const result = await this.pool.query<RecommendationRow>(
      `SELECT ${columns} FROM recommendations WHERE conversation_id=$1 ORDER BY created_at,recommendation_id`,
      [conversationId],
    );
    return result.rows.map(mapRecommendation);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
