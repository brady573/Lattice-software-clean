import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { isConsultationRunRequest, type LatticeRun } from "../domain.js";
import type { KnowledgeOutcome } from "../outcome.js";
import type { TruthBundle } from "../truth/types.js";

const migration = "033_knowledge_records.sql" as const;

export interface KnowledgeRecord {
  knowledgeId: string;
  conversationId: string;
  runId: string;
  intentScopeId: string;
  intentVersionId: string;
  sourceMessageId: string;
  objective: string;
  claimIds: string[];
  sourceIds: string[];
  evidenceIds: string[];
  truthAssessmentIds: string[];
  uncertainties: string[];
  asOf: string;
  createdAt: string;
}

export interface KnowledgeRecordStore {
  readonly kind: "memory" | "postgres";
  putKnowledge(record: KnowledgeRecord): Promise<KnowledgeRecord>;
  getKnowledge(knowledgeId: string): Promise<KnowledgeRecord | undefined>;
  getKnowledgeByRunId(runId: string): Promise<KnowledgeRecord | undefined>;
  listKnowledgeByConversation(conversationId: string): Promise<KnowledgeRecord[]>;
  close(): Promise<void>;
}

function bounded(value: string, label: string, max = 8_000): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new Error(`${label} must contain between 1 and ${max} non-whitespace characters.`);
  }
  return normalized;
}

function stableId(prefix: string, ...parts: string[]): string {
  const digest = createHash("sha256").update(parts.join("\u001f")).digest("hex");
  return `${prefix}_${digest.slice(0, 40)}`;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort();
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

function usedEvidenceIds(knowledge: KnowledgeOutcome): string[] {
  return unique(knowledge.findings.flatMap((finding) => [
    ...finding.evidenceIds,
    ...finding.contradictoryEvidenceIds,
  ]));
}

function usedSourceIds(knowledge: KnowledgeOutcome, evidenceIds: readonly string[]): string[] {
  const acceptedEvidence = new Set(evidenceIds);
  return unique((knowledge.evidence ?? [])
    .filter((item) => acceptedEvidence.has(item.evidenceId))
    .map((item) => item.sourceId));
}

function knowledgeAsOf(truth: TruthBundle, sourceIds: readonly string[]): string {
  const used = new Set(sourceIds);
  const dates = truth.sources
    .filter((source) => used.size === 0 || used.has(source.id))
    .map((source) => new Date(source.retrievedAt))
    .filter((date) => !Number.isNaN(date.valueOf()))
    .sort((left, right) => right.valueOf() - left.valueOf());
  return (dates[0] ?? new Date()).toISOString();
}

export function buildKnowledgeRecord(
  run: LatticeRun,
  truth: TruthBundle,
  knowledge: KnowledgeOutcome,
  createdAt = new Date().toISOString(),
): KnowledgeRecord {
  if (!isConsultationRunRequest(run.request)) {
    throw new Error("First-class Knowledge records require a canonical consultation Run.");
  }
  const intentScopeId = run.request.intentScopeId;
  const intentVersionId = run.request.intentVersionId;
  if (!intentScopeId || !intentVersionId) {
    throw new Error("Knowledge record requires an exact authoritative IntentVersion binding.");
  }
  if (truth.runId !== run.id) throw new Error("Knowledge record TruthBundle must belong to the same Run.");
  if (knowledge.objective !== run.request.objective) {
    throw new Error("Knowledge record objective must preserve the authoritative Run objective.");
  }

  const evidenceIds = usedEvidenceIds(knowledge);
  const sourceIds = usedSourceIds(knowledge, evidenceIds);
  return Object.freeze({
    knowledgeId: stableId("knowledge", run.id, intentVersionId),
    conversationId: bounded(run.conversationId, "conversationId", 128),
    runId: bounded(run.id, "runId", 200),
    intentScopeId: bounded(intentScopeId, "intentScopeId", 200),
    intentVersionId: bounded(intentVersionId, "intentVersionId", 200),
    sourceMessageId: bounded(run.request.sourceMessageId, "sourceMessageId", 200),
    objective: bounded(knowledge.objective, "objective"),
    claimIds: unique(knowledge.findings.map((finding) => finding.claimId)),
    sourceIds,
    evidenceIds,
    truthAssessmentIds: unique(knowledge.truthAssessmentIds),
    uncertainties: [...knowledge.uncertainties],
    asOf: knowledgeAsOf(truth, sourceIds),
    createdAt: dateOrThrow(createdAt, "createdAt"),
  });
}

export class MemoryKnowledgeRecordStore implements KnowledgeRecordStore {
  readonly kind = "memory" as const;
  private readonly knowledge = new Map<string, KnowledgeRecord>();
  private readonly knowledgeByRun = new Map<string, string>();

  async putKnowledge(record: KnowledgeRecord): Promise<KnowledgeRecord> {
    const existing = this.knowledge.get(record.knowledgeId);
    if (existing) {
      if (!sameRecord(existing, record)) throw new Error("Knowledge identity cannot be rebound to different governed state.");
      return clone(existing);
    }
    const runKnowledge = this.knowledgeByRun.get(record.runId);
    if (runKnowledge && runKnowledge !== record.knowledgeId) {
      throw new Error("A Run cannot establish multiple Knowledge identities.");
    }
    this.knowledge.set(record.knowledgeId, clone(record));
    this.knowledgeByRun.set(record.runId, record.knowledgeId);
    return clone(record);
  }

  async getKnowledge(knowledgeId: string): Promise<KnowledgeRecord | undefined> {
    const record = this.knowledge.get(knowledgeId);
    return record ? clone(record) : undefined;
  }

  async getKnowledgeByRunId(runId: string): Promise<KnowledgeRecord | undefined> {
    const knowledgeId = this.knowledgeByRun.get(runId);
    return knowledgeId ? await this.getKnowledge(knowledgeId) : undefined;
  }

  async listKnowledgeByConversation(conversationId: string): Promise<KnowledgeRecord[]> {
    return [...this.knowledge.values()]
      .filter((record) => record.conversationId === conversationId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.knowledgeId.localeCompare(right.knowledgeId))
      .map(clone);
  }

  async close(): Promise<void> {
    this.knowledge.clear();
    this.knowledgeByRun.clear();
  }
}

type KnowledgeRow = {
  knowledge_id: string;
  conversation_id: string;
  run_id: string;
  intent_scope_id: string;
  intent_version_id: string;
  source_message_id: string;
  objective: string;
  claim_ids: unknown;
  source_ids: unknown;
  evidence_ids: unknown;
  truth_assessment_ids: unknown;
  uncertainties: unknown;
  as_of: Date | string;
  created_at: Date | string;
};

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`Persisted ${label} is invalid.`);
  }
  return [...value];
}

function mapKnowledge(row: KnowledgeRow): KnowledgeRecord {
  return {
    knowledgeId: row.knowledge_id,
    conversationId: row.conversation_id,
    runId: row.run_id,
    intentScopeId: row.intent_scope_id,
    intentVersionId: row.intent_version_id,
    sourceMessageId: row.source_message_id,
    objective: row.objective,
    claimIds: stringArray(row.claim_ids, "claim_ids"),
    sourceIds: stringArray(row.source_ids, "source_ids"),
    evidenceIds: stringArray(row.evidence_ids, "evidence_ids"),
    truthAssessmentIds: stringArray(row.truth_assessment_ids, "truth_assessment_ids"),
    uncertainties: stringArray(row.uncertainties, "uncertainties"),
    asOf: dateOrThrow(row.as_of instanceof Date ? row.as_of.toISOString() : row.as_of, "as_of"),
    createdAt: dateOrThrow(row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at, "created_at"),
  };
}

async function applyMigration(pool: Pool): Promise<void> {
  await pool.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
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
    throw new Error(`Knowledge schema is not ready; required migration ${migration} is missing.`);
  }
}

const knowledgeColumns = "knowledge_id,conversation_id,run_id,intent_scope_id,intent_version_id,source_message_id,objective,claim_ids,source_ids,evidence_ids,truth_assessment_ids,uncertainties,as_of,created_at";

export class PostgresKnowledgeRecordStore implements KnowledgeRecordStore {
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
    const { backfillLegacyConversationKnowledgeReferences } = await import(
      "../conversation/conversation-reference-backfill.js"
    );
    await backfillLegacyConversationKnowledgeReferences(databaseUrl);
  }

  static async connect(databaseUrl: string): Promise<PostgresKnowledgeRecordStore> {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query("SELECT 1");
      await assertReady(pool);
      return new PostgresKnowledgeRecordStore(pool);
    } catch (error) {
      await pool.end();
      throw error;
    }
  }

  async putKnowledge(record: KnowledgeRecord): Promise<KnowledgeRecord> {
    const result = await this.pool.query<KnowledgeRow>(
      `INSERT INTO knowledge_records(${knowledgeColumns})
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14)
       ON CONFLICT(knowledge_id) DO NOTHING
       RETURNING ${knowledgeColumns}`,
      [
        record.knowledgeId,
        record.conversationId,
        record.runId,
        record.intentScopeId,
        record.intentVersionId,
        record.sourceMessageId,
        record.objective,
        JSON.stringify(record.claimIds),
        JSON.stringify(record.sourceIds),
        JSON.stringify(record.evidenceIds),
        JSON.stringify(record.truthAssessmentIds),
        JSON.stringify(record.uncertainties),
        record.asOf,
        record.createdAt,
      ],
    );
    const inserted = result.rows[0];
    if (inserted) return mapKnowledge(inserted);
    const existing = await this.getKnowledge(record.knowledgeId);
    if (!existing || !sameRecord(existing, record)) {
      throw new Error("Knowledge identity cannot be rebound to different governed state.");
    }
    return existing;
  }

  async getKnowledge(knowledgeId: string): Promise<KnowledgeRecord | undefined> {
    const result = await this.pool.query<KnowledgeRow>(
      `SELECT ${knowledgeColumns} FROM knowledge_records WHERE knowledge_id=$1`,
      [knowledgeId],
    );
    return result.rows[0] ? mapKnowledge(result.rows[0]) : undefined;
  }

  async getKnowledgeByRunId(runId: string): Promise<KnowledgeRecord | undefined> {
    const result = await this.pool.query<KnowledgeRow>(
      `SELECT ${knowledgeColumns} FROM knowledge_records WHERE run_id=$1`,
      [runId],
    );
    return result.rows[0] ? mapKnowledge(result.rows[0]) : undefined;
  }

  async listKnowledgeByConversation(conversationId: string): Promise<KnowledgeRecord[]> {
    const result = await this.pool.query<KnowledgeRow>(
      `SELECT ${knowledgeColumns} FROM knowledge_records WHERE conversation_id=$1 ORDER BY created_at,knowledge_id`,
      [conversationId],
    );
    return result.rows.map(mapKnowledge);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
