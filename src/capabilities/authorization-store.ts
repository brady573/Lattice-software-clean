import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import type { ModelInvocationProvenance } from "../model/types.js";

const migration = "036_capability_authorizations.sql" as const;

export type CapabilityGrantStatus = "CONNECTED" | "DISCONNECTED";
export type CapabilityInvocationOutcome = "SUCCEEDED" | "PROVIDER_FAILURE" | "REVOKED";

export interface CapabilityInvocationEvidence {
  readonly requestId: string;
  readonly purpose: string;
  readonly outcome: CapabilityInvocationOutcome;
  readonly recordedAt: string;
  readonly provenance: ModelInvocationProvenance | null;
  readonly failureCode: string | null;
}

export interface CapabilityGrantState {
  readonly subjectId: string;
  readonly capabilityId: string;
  readonly status: CapabilityGrantStatus;
  readonly version: number;
  readonly updatedAt: string | null;
  readonly lastInvocation: CapabilityInvocationEvidence | null;
}

export interface CapabilityAuthorizationStore {
  readonly kind: "memory" | "postgres";
  get(subjectId: string, capabilityId: string): Promise<CapabilityGrantState>;
  connect(subjectId: string, capabilityId: string): Promise<CapabilityGrantState>;
  disconnect(subjectId: string, capabilityId: string): Promise<CapabilityGrantState>;
  recordInvocation(subjectId: string, capabilityId: string, evidence: CapabilityInvocationEvidence): Promise<void>;
  close(): Promise<void>;
}

function requireKey(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 200) throw new Error(`${label} must contain between 1 and 200 non-whitespace characters.`);
  return normalized;
}

function key(subjectId: string, capabilityId: string): string {
  return `${requireKey(subjectId, "subjectId")}\u0000${requireKey(capabilityId, "capabilityId")}`;
}

function defaultState(subjectId: string, capabilityId: string): CapabilityGrantState {
  return {
    subjectId: requireKey(subjectId, "subjectId"),
    capabilityId: requireKey(capabilityId, "capabilityId"),
    status: "DISCONNECTED",
    version: 0,
    updatedAt: null,
    lastInvocation: null,
  };
}

export class MemoryCapabilityAuthorizationStore implements CapabilityAuthorizationStore {
  readonly kind = "memory" as const;
  private readonly states = new Map<string, CapabilityGrantState>();

  async get(subjectId: string, capabilityId: string): Promise<CapabilityGrantState> {
    return structuredClone(this.states.get(key(subjectId, capabilityId)) ?? defaultState(subjectId, capabilityId));
  }

  private async setStatus(subjectId: string, capabilityId: string, status: CapabilityGrantStatus): Promise<CapabilityGrantState> {
    const mapKey = key(subjectId, capabilityId);
    const current = this.states.get(mapKey) ?? defaultState(subjectId, capabilityId);
    if (current.status === status && current.version > 0) return structuredClone(current);
    const next: CapabilityGrantState = {
      ...structuredClone(current),
      status,
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    };
    this.states.set(mapKey, structuredClone(next));
    return structuredClone(next);
  }

  async connect(subjectId: string, capabilityId: string): Promise<CapabilityGrantState> {
    return await this.setStatus(subjectId, capabilityId, "CONNECTED");
  }

  async disconnect(subjectId: string, capabilityId: string): Promise<CapabilityGrantState> {
    return await this.setStatus(subjectId, capabilityId, "DISCONNECTED");
  }

  async recordInvocation(subjectId: string, capabilityId: string, evidence: CapabilityInvocationEvidence): Promise<void> {
    const mapKey = key(subjectId, capabilityId);
    const current = this.states.get(mapKey) ?? defaultState(subjectId, capabilityId);
    if (current.version === 0) return;
    this.states.set(mapKey, { ...structuredClone(current), lastInvocation: structuredClone(evidence) });
  }

  async close(): Promise<void> {
    this.states.clear();
  }
}

type GrantRow = {
  subject_id: string;
  capability_id: string;
  status: CapabilityGrantStatus;
  version: number | string;
  updated_at: Date | string;
  last_invocation_json: CapabilityInvocationEvidence | null;
};

function mapRow(row: GrantRow): CapabilityGrantState {
  return {
    subjectId: row.subject_id,
    capabilityId: row.capability_id,
    status: row.status,
    version: Number(row.version),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : new Date(row.updated_at).toISOString(),
    lastInvocation: row.last_invocation_json === null ? null : structuredClone(row.last_invocation_json),
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
  if (result.rows[0]?.count !== "1") throw new Error(`Capability authorization schema is not ready; required migration ${migration} is missing.`);
}

export class PostgresCapabilityAuthorizationStore implements CapabilityAuthorizationStore {
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

  static async connect(databaseUrl: string): Promise<PostgresCapabilityAuthorizationStore> {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query("SELECT 1");
      await assertReady(pool);
      return new PostgresCapabilityAuthorizationStore(pool);
    } catch (error) {
      await pool.end();
      throw error;
    }
  }

  async get(subjectId: string, capabilityId: string): Promise<CapabilityGrantState> {
    const subject = requireKey(subjectId, "subjectId");
    const capability = requireKey(capabilityId, "capabilityId");
    const result = await this.pool.query<GrantRow>(
      "SELECT subject_id,capability_id,status,version,updated_at,last_invocation_json FROM capability_authorizations WHERE subject_id=$1 AND capability_id=$2",
      [subject, capability],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : defaultState(subject, capability);
  }

  private async setStatus(subjectId: string, capabilityId: string, status: CapabilityGrantStatus): Promise<CapabilityGrantState> {
    const subject = requireKey(subjectId, "subjectId");
    const capability = requireKey(capabilityId, "capabilityId");
    const result = await this.pool.query<GrantRow>(
      `INSERT INTO capability_authorizations(subject_id,capability_id,status,version,updated_at)
       VALUES ($1,$2,$3,1,now())
       ON CONFLICT(subject_id,capability_id) DO UPDATE SET
         status=EXCLUDED.status,
         version=CASE WHEN capability_authorizations.status=EXCLUDED.status THEN capability_authorizations.version ELSE capability_authorizations.version+1 END,
         updated_at=CASE WHEN capability_authorizations.status=EXCLUDED.status THEN capability_authorizations.updated_at ELSE now() END
       RETURNING subject_id,capability_id,status,version,updated_at,last_invocation_json`,
      [subject, capability, status],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Capability authorization update returned no state.");
    return mapRow(row);
  }

  async connect(subjectId: string, capabilityId: string): Promise<CapabilityGrantState> {
    return await this.setStatus(subjectId, capabilityId, "CONNECTED");
  }

  async disconnect(subjectId: string, capabilityId: string): Promise<CapabilityGrantState> {
    return await this.setStatus(subjectId, capabilityId, "DISCONNECTED");
  }

  async recordInvocation(subjectId: string, capabilityId: string, evidence: CapabilityInvocationEvidence): Promise<void> {
    await this.pool.query(
      "UPDATE capability_authorizations SET last_invocation_json=$3::jsonb WHERE subject_id=$1 AND capability_id=$2",
      [requireKey(subjectId, "subjectId"), requireKey(capabilityId, "capabilityId"), JSON.stringify(evidence)],
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
