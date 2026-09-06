import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import type { ModelErrorCode } from "./model/errors.js";
import type {
  ModelExecutionClass,
  ModelInvocationProvenance,
  ModelRouteMode,
  ModelRouteProvenanceCompleteness,
} from "./model/types.js";

const migration = "032_model_assistance_authorization.sql" as const;

export type ModelAssistanceAuthorizationStatus = "CONNECTED" | "DISCONNECTED";
export type ModelAssistanceInvocationOutcome =
  | "SUCCEEDED"
  | "FIDELITY_REJECTED"
  | "PROVIDER_FAILURE"
  | "REVOKED";

export interface ModelAssistanceInvocationProvenance {
  executionClass: ModelExecutionClass | null;
  routeMode: ModelRouteMode | null;
  actualProvider: string | null;
  actualModel: string | null;
  upstreamRequestId: string | null;
  routeProvenance: ModelRouteProvenanceCompleteness;
}

export interface ModelAssistanceInvocationEvidence {
  runId: string;
  outcome: ModelAssistanceInvocationOutcome;
  recordedAt: string;
  provenance: ModelAssistanceInvocationProvenance | null;
  failureCode: ModelErrorCode | null;
}

export interface ModelAssistanceAuthorizationState {
  subjectId: string;
  status: ModelAssistanceAuthorizationStatus;
  version: number;
  updatedAt: string | null;
  lastInvocation: ModelAssistanceInvocationEvidence | null;
}

export interface ModelAssistanceAuthorizationStore {
  readonly kind: "memory" | "postgres";
  get(subjectId: string): Promise<ModelAssistanceAuthorizationState>;
  connect(subjectId: string): Promise<ModelAssistanceAuthorizationState>;
  disconnect(subjectId: string): Promise<ModelAssistanceAuthorizationState>;
  recordInvocation(subjectId: string, evidence: ModelAssistanceInvocationEvidence): Promise<void>;
  close(): Promise<void>;
}

function requireSubjectId(value: string): string {
  const subjectId = value.trim();
  if (!subjectId || subjectId.length > 200) {
    throw new Error("Model assistance subjectId must contain between 1 and 200 non-whitespace characters.");
  }
  return subjectId;
}

function defaultState(subjectId: string): ModelAssistanceAuthorizationState {
  return {
    subjectId: requireSubjectId(subjectId),
    status: "DISCONNECTED",
    version: 0,
    updatedAt: null,
    lastInvocation: null,
  };
}

function cloneState(value: ModelAssistanceAuthorizationState): ModelAssistanceAuthorizationState {
  return structuredClone(value);
}

export function modelAssistanceInvocationProvenance(
  value: ModelInvocationProvenance,
): ModelAssistanceInvocationProvenance {
  return Object.freeze({
    executionClass: value.executionClass,
    routeMode: value.routeMode,
    actualProvider: value.actualProvider,
    actualModel: value.actualModel,
    upstreamRequestId: value.upstreamRequestId,
    routeProvenance: value.routeProvenance,
  });
}

export class MemoryModelAssistanceAuthorizationStore implements ModelAssistanceAuthorizationStore {
  readonly kind = "memory" as const;
  private readonly states = new Map<string, ModelAssistanceAuthorizationState>();

  async get(subjectId: string): Promise<ModelAssistanceAuthorizationState> {
    const normalized = requireSubjectId(subjectId);
    return cloneState(this.states.get(normalized) ?? defaultState(normalized));
  }

  private async setStatus(
    subjectId: string,
    status: ModelAssistanceAuthorizationStatus,
  ): Promise<ModelAssistanceAuthorizationState> {
    const normalized = requireSubjectId(subjectId);
    const current = this.states.get(normalized) ?? defaultState(normalized);
    if (current.status === status && current.version > 0) return cloneState(current);
    const next: ModelAssistanceAuthorizationState = {
      ...cloneState(current),
      status,
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    };
    this.states.set(normalized, cloneState(next));
    return cloneState(next);
  }

  async connect(subjectId: string): Promise<ModelAssistanceAuthorizationState> {
    return await this.setStatus(subjectId, "CONNECTED");
  }

  async disconnect(subjectId: string): Promise<ModelAssistanceAuthorizationState> {
    return await this.setStatus(subjectId, "DISCONNECTED");
  }

  async recordInvocation(subjectId: string, evidence: ModelAssistanceInvocationEvidence): Promise<void> {
    const normalized = requireSubjectId(subjectId);
    const current = this.states.get(normalized) ?? defaultState(normalized);
    if (current.version === 0) return;
    this.states.set(normalized, {
      ...cloneState(current),
      lastInvocation: structuredClone(evidence),
    });
  }

  async close(): Promise<void> {
    this.states.clear();
  }
}

type AuthorizationRow = {
  subject_id: string;
  status: ModelAssistanceAuthorizationStatus;
  version: number | string;
  updated_at: Date | string;
  last_invocation_json: unknown;
};

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isExecutionClass(value: unknown): value is ModelExecutionClass {
  return value === "LOCAL_OFFLINE" || value === "LIVE_BROKERED" || value === "LIVE_DIRECT";
}

function isRouteMode(value: unknown): value is ModelRouteMode {
  return value === "PINNED" || value === "PRODUCT_ROUTED" || value === "BROKER_AUTOMATIC";
}

function isRouteProvenance(value: unknown): value is ModelRouteProvenanceCompleteness {
  return value === "COMPLETE" || value === "PARTIAL" || value === "MISSING";
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function parseInvocation(value: unknown): ModelAssistanceInvocationEvidence | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const runId = optionalString(record.runId);
  const outcome = record.outcome;
  const recordedAt = optionalString(record.recordedAt);
  if (
    runId === null
    || recordedAt === null
    || (outcome !== "SUCCEEDED"
      && outcome !== "FIDELITY_REJECTED"
      && outcome !== "PROVIDER_FAILURE"
      && outcome !== "REVOKED")
  ) return null;

  let provenance: ModelAssistanceInvocationProvenance | null = null;
  if (record.provenance !== null && typeof record.provenance === "object" && !Array.isArray(record.provenance)) {
    const raw = record.provenance as Record<string, unknown>;
    const executionClass = raw.executionClass === null ? null : isExecutionClass(raw.executionClass) ? raw.executionClass : undefined;
    const routeMode = raw.routeMode === null ? null : isRouteMode(raw.routeMode) ? raw.routeMode : undefined;
    if (executionClass !== undefined && routeMode !== undefined && isRouteProvenance(raw.routeProvenance)) {
      provenance = {
        executionClass,
        routeMode,
        actualProvider: optionalString(raw.actualProvider),
        actualModel: optionalString(raw.actualModel),
        upstreamRequestId: optionalString(raw.upstreamRequestId),
        routeProvenance: raw.routeProvenance,
      };
    }
  }

  const failureCode = optionalString(record.failureCode) as ModelErrorCode | null;
  return {
    runId,
    outcome,
    recordedAt,
    provenance,
    failureCode,
  };
}

function mapState(row: AuthorizationRow): ModelAssistanceAuthorizationState {
  return {
    subjectId: row.subject_id,
    status: row.status,
    version: Number(row.version),
    updatedAt: iso(row.updated_at),
    lastInvocation: parseInvocation(row.last_invocation_json),
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
    throw new Error(`Model assistance schema is not ready; required migration ${migration} is missing.`);
  }
}

export class PostgresModelAssistanceAuthorizationStore implements ModelAssistanceAuthorizationStore {
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

  static async connect(databaseUrl: string): Promise<PostgresModelAssistanceAuthorizationStore> {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query("SELECT 1");
      await assertReady(pool);
      return new PostgresModelAssistanceAuthorizationStore(pool);
    } catch (error) {
      await pool.end();
      throw error;
    }
  }

  async get(subjectId: string): Promise<ModelAssistanceAuthorizationState> {
    const normalized = requireSubjectId(subjectId);
    const result = await this.pool.query<AuthorizationRow>(
      "SELECT subject_id,status,version,updated_at,last_invocation_json FROM model_assistance_authorizations WHERE subject_id=$1",
      [normalized],
    );
    const row = result.rows[0];
    return row ? mapState(row) : defaultState(normalized);
  }

  private async setStatus(
    subjectId: string,
    status: ModelAssistanceAuthorizationStatus,
  ): Promise<ModelAssistanceAuthorizationState> {
    const normalized = requireSubjectId(subjectId);
    const result = await this.pool.query<AuthorizationRow>(
      `INSERT INTO model_assistance_authorizations(subject_id,status,version,updated_at)
       VALUES ($1,$2,1,now())
       ON CONFLICT(subject_id) DO UPDATE SET
         status=EXCLUDED.status,
         version=CASE
           WHEN model_assistance_authorizations.status=EXCLUDED.status THEN model_assistance_authorizations.version
           ELSE model_assistance_authorizations.version+1
         END,
         updated_at=CASE
           WHEN model_assistance_authorizations.status=EXCLUDED.status THEN model_assistance_authorizations.updated_at
           ELSE now()
         END
       RETURNING subject_id,status,version,updated_at,last_invocation_json`,
      [normalized, status],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Model assistance authorization update returned no state.");
    return mapState(row);
  }

  async connect(subjectId: string): Promise<ModelAssistanceAuthorizationState> {
    return await this.setStatus(subjectId, "CONNECTED");
  }

  async disconnect(subjectId: string): Promise<ModelAssistanceAuthorizationState> {
    return await this.setStatus(subjectId, "DISCONNECTED");
  }

  async recordInvocation(subjectId: string, evidence: ModelAssistanceInvocationEvidence): Promise<void> {
    const normalized = requireSubjectId(subjectId);
    await this.pool.query(
      "UPDATE model_assistance_authorizations SET last_invocation_json=$2::jsonb WHERE subject_id=$1",
      [normalized, JSON.stringify(evidence)],
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
