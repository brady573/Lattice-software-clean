import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { Pool } from "pg";
import type { RunRequest } from "../domain.js";
import { assertPlanningMaterialFaithfulToExactIntent } from "./exact-planning-fidelity.js";
import type { IntentAuthorityStore } from "./store.js";
import type { IntentState } from "./types.js";

const migration = "029_run_decision_plan_binding.sql" as const;

export interface DurableDecisionPlan {
  decisionPlanId: string;
  runId: string;
  intentScopeId: string;
  intentVersionId: string;
  planningMaterial: RunRequest;
  boundAt: string;
}

export interface DecisionPlanStore {
  readonly kind: "memory" | "postgres";
  bind(input: Omit<DurableDecisionPlan, "boundAt">): Promise<DurableDecisionPlan>;
  getByRunId(runId: string): Promise<DurableDecisionPlan | undefined>;
  close(): Promise<void>;
}

export function decisionPlanIdForRun(runId: string): string {
  return `decision-plan:${runId}`;
}

function samePlan(left: DurableDecisionPlan, right: Omit<DurableDecisionPlan, "boundAt">): boolean {
  return left.decisionPlanId === right.decisionPlanId
    && left.runId === right.runId
    && left.intentScopeId === right.intentScopeId
    && left.intentVersionId === right.intentVersionId
    && isDeepStrictEqual(left.planningMaterial, right.planningMaterial);
}

export class MemoryDecisionPlanStore implements DecisionPlanStore {
  readonly kind = "memory" as const;
  private readonly plansByRunId = new Map<string, DurableDecisionPlan>();

  constructor(private readonly intentStore: IntentAuthorityStore) {
    if (intentStore.kind !== "memory") throw new Error("Memory DecisionPlan store requires memory Intent Authority.");
  }

  async bind(input: Omit<DurableDecisionPlan, "boundAt">): Promise<DurableDecisionPlan> {
    const exactVersion = await this.intentStore.getVersion(input.intentVersionId);
    if (!exactVersion || exactVersion.intentScopeId !== input.intentScopeId) {
      throw new Error("DecisionPlan must bind an existing exact IntentVersion in the requested IntentScope.");
    }
    assertPlanningMaterialFaithfulToExactIntent(exactVersion.state, input.planningMaterial);
    const existing = this.plansByRunId.get(input.runId);
    if (existing) {
      if (!samePlan(existing, input)) throw new Error("Run DecisionPlan identity was reused with different planning material.");
      return structuredClone(existing);
    }
    const plan: DurableDecisionPlan = {
      ...structuredClone(input),
      boundAt: new Date().toISOString(),
    };
    this.plansByRunId.set(plan.runId, structuredClone(plan));
    return structuredClone(plan);
  }

  async getByRunId(runId: string): Promise<DurableDecisionPlan | undefined> {
    const plan = this.plansByRunId.get(runId);
    return plan ? structuredClone(plan) : undefined;
  }

  async close(): Promise<void> {
    this.plansByRunId.clear();
  }
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
  const result = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM schema_migrations WHERE name=$1", [migration]);
  if (result.rows[0]?.count !== "1") throw new Error(`DecisionPlan schema is not ready; required migration ${migration} is missing.`);
}

export class PostgresDecisionPlanStore implements DecisionPlanStore {
  readonly kind = "postgres" as const;
  private constructor(private readonly pool: Pool) {}

  static async migrate(connectionString: string): Promise<void> {
    const pool = new Pool({ connectionString });
    try {
      await pool.query("SELECT 1");
      await applyMigration(pool);
      await assertReady(pool);
    } finally {
      await pool.end();
    }
  }

  static async connect(connectionString: string, options: { migrate?: boolean } = {}): Promise<PostgresDecisionPlanStore> {
    const pool = new Pool({ connectionString });
    try {
      await pool.query("SELECT 1");
      if (options.migrate ?? false) await applyMigration(pool);
      await assertReady(pool);
      return new PostgresDecisionPlanStore(pool);
    } catch (error) {
      await pool.end();
      throw error;
    }
  }

  async bind(input: Omit<DurableDecisionPlan, "boundAt">): Promise<DurableDecisionPlan> {
    const exact = await this.pool.query<{ intent_version_id: string; state_json: IntentState }>(
      "SELECT intent_version_id,state_json FROM intent_versions WHERE intent_scope_id=$1 AND intent_version_id=$2",
      [input.intentScopeId, input.intentVersionId],
    );
    const exactRow = exact.rows[0];
    if (!exactRow) throw new Error("DecisionPlan must bind an existing exact IntentVersion in the requested IntentScope.");
    assertPlanningMaterialFaithfulToExactIntent(exactRow.state_json, input.planningMaterial);

    const inserted = await this.pool.query<{
      decision_plan_id: string;
      run_id: string;
      intent_scope_id: string;
      intent_version_id: string;
      planning_material_json: RunRequest;
      bound_at: Date | string;
    }>(
      `INSERT INTO decision_plans(decision_plan_id,run_id,intent_scope_id,intent_version_id,planning_material_json)
       VALUES ($1,$2,$3,$4,$5::jsonb)
       ON CONFLICT (run_id) DO NOTHING
       RETURNING decision_plan_id,run_id,intent_scope_id,intent_version_id,planning_material_json,bound_at`,
      [input.decisionPlanId, input.runId, input.intentScopeId, input.intentVersionId, JSON.stringify(input.planningMaterial)],
    );
    const row = inserted.rows[0];
    if (row) {
      return {
        decisionPlanId: row.decision_plan_id,
        runId: row.run_id,
        intentScopeId: row.intent_scope_id,
        intentVersionId: row.intent_version_id,
        planningMaterial: row.planning_material_json,
        boundAt: row.bound_at instanceof Date ? row.bound_at.toISOString() : new Date(row.bound_at).toISOString(),
      };
    }
    const existing = await this.getByRunId(input.runId);
    if (!existing || !samePlan(existing, input)) {
      throw new Error("Run DecisionPlan identity was reused with different planning material.");
    }
    return existing;
  }

  async getByRunId(runId: string): Promise<DurableDecisionPlan | undefined> {
    const result = await this.pool.query<{
      decision_plan_id: string;
      run_id: string;
      intent_scope_id: string;
      intent_version_id: string;
      planning_material_json: RunRequest;
      bound_at: Date | string;
    }>(
      "SELECT decision_plan_id,run_id,intent_scope_id,intent_version_id,planning_material_json,bound_at FROM decision_plans WHERE run_id=$1",
      [runId],
    );
    const row = result.rows[0];
    return row ? {
      decisionPlanId: row.decision_plan_id,
      runId: row.run_id,
      intentScopeId: row.intent_scope_id,
      intentVersionId: row.intent_version_id,
      planningMaterial: row.planning_material_json,
      boundAt: row.bound_at instanceof Date ? row.bound_at.toISOString() : new Date(row.bound_at).toISOString(),
    } : undefined;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
