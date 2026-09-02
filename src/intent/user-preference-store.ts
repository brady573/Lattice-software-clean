import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";
import { z } from "zod";
import {
  intentProvenanceSchema,
  intentSetValueSchema,
  type IntentProvenance,
  type IntentSetValue,
} from "./types.js";

const migration = "031_user_preferences.sql" as const;

export type UserPreferenceStatus = "ACTIVE" | "REVOKED";

export interface UserPreference {
  preferenceId: string;
  ownerSubjectId: string;
  semanticKey: string;
  value: IntentSetValue;
  provenance: IntentProvenance;
  version: number;
  status: UserPreferenceStatus;
  createdAt: string;
  updatedAt: string;
}

export interface UserPreferenceRevision extends UserPreference {
  recordedAt: string;
}

export interface CreateUserPreferenceInput {
  preferenceId: string;
  ownerSubjectId: string;
  semanticKey: string;
  value: IntentSetValue;
  provenance: IntentProvenance;
}

export interface UpdateUserPreferenceInput {
  preferenceId: string;
  ownerSubjectId: string;
  expectedVersion: number;
  value: IntentSetValue;
  provenance: IntentProvenance;
}

export interface RevokeUserPreferenceInput {
  preferenceId: string;
  ownerSubjectId: string;
  expectedVersion: number;
  provenance: IntentProvenance;
}

export interface UserPreferenceStore {
  readonly kind: "memory" | "postgres";
  create(input: CreateUserPreferenceInput): Promise<UserPreference>;
  listActive(ownerSubjectId: string): Promise<UserPreference[]>;
  getActive(preferenceId: string, ownerSubjectId: string): Promise<UserPreference | undefined>;
  update(input: UpdateUserPreferenceInput): Promise<UserPreference>;
  revoke(input: RevokeUserPreferenceInput): Promise<UserPreference>;
  listRevisions(preferenceId: string, ownerSubjectId: string): Promise<UserPreferenceRevision[]>;
  close(): Promise<void>;
}

export class UserPreferenceNotFoundError extends Error {
  constructor() {
    super("User preference was not found.");
    this.name = "UserPreferenceNotFoundError";
  }
}

export class UserPreferenceVersionConflictError extends Error {
  constructor() {
    super("User preference version conflict.");
    this.name = "UserPreferenceVersionConflictError";
  }
}

export class UserPreferenceConflictError extends Error {
  constructor() {
    super("An active user preference already occupies this semantic key.");
    this.name = "UserPreferenceConflictError";
  }
}

const userAuthoredProvenanceSchema = intentProvenanceSchema.refine(
  (provenance) => provenance.kind === "EXPLICIT_USER" || provenance.kind === "USER_CONFIRMED",
  "Reusable preferences require explicit USER-authored or exact USER-confirmed provenance.",
);

const commonInputShape = {
  preferenceId: z.string().min(1),
  ownerSubjectId: z.string().min(1),
};

const createUserPreferenceSchema = z.object({
  ...commonInputShape,
  semanticKey: z.string().min(1).refine((key) => key.trim() === key, "semanticKey must be trimmed."),
  value: intentSetValueSchema,
  provenance: userAuthoredProvenanceSchema,
}).strict();

const updateUserPreferenceSchema = z.object({
  ...commonInputShape,
  expectedVersion: z.number().int().positive(),
  value: intentSetValueSchema,
  provenance: userAuthoredProvenanceSchema,
}).strict();

const revokeUserPreferenceSchema = z.object({
  ...commonInputShape,
  expectedVersion: z.number().int().positive(),
  provenance: userAuthoredProvenanceSchema,
}).strict();

function clonePreference<T extends UserPreference | UserPreferenceRevision>(value: T): T {
  return structuredClone(value);
}

function activeKey(ownerSubjectId: string, semanticKey: string): string {
  return `${ownerSubjectId}\u0000${semanticKey}`;
}

export class MemoryUserPreferenceStore implements UserPreferenceStore {
  readonly kind = "memory" as const;
  private readonly preferences = new Map<string, UserPreference>();
  private readonly revisions = new Map<string, UserPreferenceRevision[]>();
  private readonly activeBySemanticKey = new Map<string, string>();

  async create(rawInput: CreateUserPreferenceInput): Promise<UserPreference> {
    const input = createUserPreferenceSchema.parse(rawInput);
    const key = activeKey(input.ownerSubjectId, input.semanticKey);
    if (this.preferences.has(input.preferenceId) || this.activeBySemanticKey.has(key)) {
      throw new UserPreferenceConflictError();
    }
    const now = new Date().toISOString();
    const preference: UserPreference = {
      ...structuredClone(input),
      version: 1,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    };
    this.preferences.set(preference.preferenceId, clonePreference(preference));
    this.activeBySemanticKey.set(key, preference.preferenceId);
    this.revisions.set(preference.preferenceId, [{ ...clonePreference(preference), recordedAt: now }]);
    return clonePreference(preference);
  }

  async listActive(ownerSubjectId: string): Promise<UserPreference[]> {
    if (ownerSubjectId.length === 0) return [];
    return [...this.preferences.values()]
      .filter((preference) => preference.ownerSubjectId === ownerSubjectId && preference.status === "ACTIVE")
      .sort((left, right) => left.semanticKey.localeCompare(right.semanticKey))
      .map(clonePreference);
  }

  async getActive(preferenceId: string, ownerSubjectId: string): Promise<UserPreference | undefined> {
    const preference = this.preferences.get(preferenceId);
    if (!preference || preference.ownerSubjectId !== ownerSubjectId || preference.status !== "ACTIVE") return undefined;
    return clonePreference(preference);
  }

  async update(rawInput: UpdateUserPreferenceInput): Promise<UserPreference> {
    const input = updateUserPreferenceSchema.parse(rawInput);
    const current = this.preferences.get(input.preferenceId);
    if (!current || current.ownerSubjectId !== input.ownerSubjectId || current.status !== "ACTIVE") {
      throw new UserPreferenceNotFoundError();
    }
    if (current.version !== input.expectedVersion) throw new UserPreferenceVersionConflictError();
    const now = new Date().toISOString();
    const updated: UserPreference = {
      ...clonePreference(current),
      value: structuredClone(input.value),
      provenance: structuredClone(input.provenance),
      version: current.version + 1,
      updatedAt: now,
    };
    this.preferences.set(updated.preferenceId, clonePreference(updated));
    this.revisions.get(updated.preferenceId)?.push({ ...clonePreference(updated), recordedAt: now });
    return clonePreference(updated);
  }

  async revoke(rawInput: RevokeUserPreferenceInput): Promise<UserPreference> {
    const input = revokeUserPreferenceSchema.parse(rawInput);
    const current = this.preferences.get(input.preferenceId);
    if (!current || current.ownerSubjectId !== input.ownerSubjectId || current.status !== "ACTIVE") {
      throw new UserPreferenceNotFoundError();
    }
    if (current.version !== input.expectedVersion) throw new UserPreferenceVersionConflictError();
    const now = new Date().toISOString();
    const revoked: UserPreference = {
      ...clonePreference(current),
      provenance: structuredClone(input.provenance),
      version: current.version + 1,
      status: "REVOKED",
      updatedAt: now,
    };
    this.preferences.set(revoked.preferenceId, clonePreference(revoked));
    this.activeBySemanticKey.delete(activeKey(revoked.ownerSubjectId, revoked.semanticKey));
    this.revisions.get(revoked.preferenceId)?.push({ ...clonePreference(revoked), recordedAt: now });
    return clonePreference(revoked);
  }

  async listRevisions(preferenceId: string, ownerSubjectId: string): Promise<UserPreferenceRevision[]> {
    const current = this.preferences.get(preferenceId);
    if (!current || current.ownerSubjectId !== ownerSubjectId) return [];
    return (this.revisions.get(preferenceId) ?? []).map(clonePreference);
  }

  async close(): Promise<void> {
    this.preferences.clear();
    this.revisions.clear();
    this.activeBySemanticKey.clear();
  }
}

type PreferenceRow = {
  preference_id: string;
  owner_subject_id: string;
  semantic_key: string;
  value_json: unknown;
  provenance_json: unknown;
  version: number | string;
  status: UserPreferenceStatus;
  created_at: Date | string;
  updated_at: Date | string;
};

type PreferenceRevisionRow = PreferenceRow & { recorded_at: Date | string };

export interface PostgresUserPreferenceOptions {
  migrate?: boolean;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapPreference(row: PreferenceRow): UserPreference {
  return {
    preferenceId: row.preference_id,
    ownerSubjectId: row.owner_subject_id,
    semanticKey: row.semantic_key,
    value: intentSetValueSchema.parse(row.value_json),
    provenance: userAuthoredProvenanceSchema.parse(row.provenance_json),
    version: Number(row.version),
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
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
    throw new Error(`User preference schema is not ready; required migration ${migration} is missing.`);
  }
}

async function insertRevision(client: PoolClient, preference: UserPreference): Promise<void> {
  await client.query(
    `INSERT INTO user_preference_revisions(
       preference_id,owner_subject_id,semantic_key,value_json,provenance_json,version,status,recorded_at
     ) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8)`,
    [
      preference.preferenceId,
      preference.ownerSubjectId,
      preference.semanticKey,
      JSON.stringify(preference.value),
      JSON.stringify(preference.provenance),
      preference.version,
      preference.status,
      preference.updatedAt,
    ],
  );
}

export class PostgresUserPreferenceStore implements UserPreferenceStore {
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

  static async connect(
    databaseUrl: string,
    options: PostgresUserPreferenceOptions = {},
  ): Promise<PostgresUserPreferenceStore> {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query("SELECT 1");
      if (options.migrate ?? false) await applyMigration(pool);
      await assertReady(pool);
      return new PostgresUserPreferenceStore(pool);
    } catch (error) {
      await pool.end();
      throw error;
    }
  }

  private async ownedActiveForUpdate(
    client: PoolClient,
    preferenceId: string,
    ownerSubjectId: string,
  ): Promise<UserPreference> {
    const result = await client.query<PreferenceRow>(
      `SELECT * FROM user_preferences
       WHERE preference_id=$1 AND owner_subject_id=$2 AND status='ACTIVE'
       FOR UPDATE`,
      [preferenceId, ownerSubjectId],
    );
    const row = result.rows[0];
    if (!row) throw new UserPreferenceNotFoundError();
    return mapPreference(row);
  }

  async create(rawInput: CreateUserPreferenceInput): Promise<UserPreference> {
    const input = createUserPreferenceSchema.parse(rawInput);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<PreferenceRow>(
        `INSERT INTO user_preferences(
           preference_id,owner_subject_id,semantic_key,value_json,provenance_json,version,status
         ) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,1,'ACTIVE')
         RETURNING *`,
        [
          input.preferenceId,
          input.ownerSubjectId,
          input.semanticKey,
          JSON.stringify(input.value),
          JSON.stringify(input.provenance),
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error("User preference insert failed.");
      const preference = mapPreference(row);
      await insertRevision(client, preference);
      await client.query("COMMIT");
      return preference;
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23505") throw new UserPreferenceConflictError();
      throw error;
    } finally {
      client.release();
    }
  }

  async listActive(ownerSubjectId: string): Promise<UserPreference[]> {
    if (ownerSubjectId.length === 0) return [];
    const result = await this.pool.query<PreferenceRow>(
      `SELECT * FROM user_preferences
       WHERE owner_subject_id=$1 AND status='ACTIVE'
       ORDER BY semantic_key, preference_id`,
      [ownerSubjectId],
    );
    return result.rows.map(mapPreference);
  }

  async getActive(preferenceId: string, ownerSubjectId: string): Promise<UserPreference | undefined> {
    const result = await this.pool.query<PreferenceRow>(
      `SELECT * FROM user_preferences
       WHERE preference_id=$1 AND owner_subject_id=$2 AND status='ACTIVE'`,
      [preferenceId, ownerSubjectId],
    );
    const row = result.rows[0];
    return row ? mapPreference(row) : undefined;
  }

  async update(rawInput: UpdateUserPreferenceInput): Promise<UserPreference> {
    const input = updateUserPreferenceSchema.parse(rawInput);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await this.ownedActiveForUpdate(client, input.preferenceId, input.ownerSubjectId);
      if (current.version !== input.expectedVersion) throw new UserPreferenceVersionConflictError();
      const result = await client.query<PreferenceRow>(
        `UPDATE user_preferences
         SET value_json=$3::jsonb,provenance_json=$4::jsonb,version=version+1,updated_at=now()
         WHERE preference_id=$1 AND owner_subject_id=$2
         RETURNING *`,
        [input.preferenceId, input.ownerSubjectId, JSON.stringify(input.value), JSON.stringify(input.provenance)],
      );
      const row = result.rows[0];
      if (!row) throw new UserPreferenceNotFoundError();
      const updated = mapPreference(row);
      await insertRevision(client, updated);
      await client.query("COMMIT");
      return updated;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async revoke(rawInput: RevokeUserPreferenceInput): Promise<UserPreference> {
    const input = revokeUserPreferenceSchema.parse(rawInput);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await this.ownedActiveForUpdate(client, input.preferenceId, input.ownerSubjectId);
      if (current.version !== input.expectedVersion) throw new UserPreferenceVersionConflictError();
      const result = await client.query<PreferenceRow>(
        `UPDATE user_preferences
         SET provenance_json=$3::jsonb,version=version+1,status='REVOKED',updated_at=now()
         WHERE preference_id=$1 AND owner_subject_id=$2
         RETURNING *`,
        [input.preferenceId, input.ownerSubjectId, JSON.stringify(input.provenance)],
      );
      const row = result.rows[0];
      if (!row) throw new UserPreferenceNotFoundError();
      const revoked = mapPreference(row);
      await insertRevision(client, revoked);
      await client.query("COMMIT");
      return revoked;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listRevisions(preferenceId: string, ownerSubjectId: string): Promise<UserPreferenceRevision[]> {
    const result = await this.pool.query<PreferenceRevisionRow>(
      `SELECT r.*,p.created_at,r.recorded_at AS updated_at
       FROM user_preference_revisions r
       INNER JOIN user_preferences p ON p.preference_id=r.preference_id AND p.owner_subject_id=r.owner_subject_id
       WHERE r.preference_id=$1 AND r.owner_subject_id=$2
       ORDER BY r.version`,
      [preferenceId, ownerSubjectId],
    );
    return result.rows.map((row) => ({ ...mapPreference(row), recordedAt: iso(row.recorded_at) }));
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
