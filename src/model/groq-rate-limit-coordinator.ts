import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";

const migration = "042_groq_rate_limit_recovery.sql" as const;
const SCOPE_PREFIX = "groq-rate-limit:v1:";

export type GroqRateLimitWait = (delayMs: number, signal: AbortSignal) => Promise<void>;

export interface GroqRateLimitCoordinator {
  readonly kind: "memory" | "postgres";
  blockedUntil(scopeId: string, signal?: AbortSignal): Promise<number>;
  extendBlockedUntil(scopeId: string, blockedUntilMs: number, signal?: AbortSignal): Promise<number>;
  waitUntilReady(scopeId: string, signal: AbortSignal): Promise<void>;
  close(): Promise<void>;
}

function boundedScope(value: string): string {
  const scopeId = value.trim();
  if (!scopeId.startsWith(SCOPE_PREFIX) || scopeId.length > 160) throw new Error("Groq rate-limit scope id is invalid.");
  return scopeId;
}

function boundedTime(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Groq blocked-until must be a non-negative safe integer.");
  return value;
}

export function groqRateLimitScopeId(apiKey: string, model: string): string {
  const secret = apiKey.trim();
  const normalizedModel = model.trim();
  if (!secret || !normalizedModel) throw new Error("Groq rate-limit scope requires credential and model identity.");
  const digest = createHash("sha256")
    .update("groq-rate-limit-scope\0")
    .update(secret)
    .update("\0")
    .update(normalizedModel)
    .digest("hex");
  return `${SCOPE_PREFIX}${digest}`;
}

const sleep: GroqRateLimitWait = async (delayMs, signal) => {
  if (delayMs <= 0) return;
  if (signal.aborted) throw signal.reason ?? new Error("Aborted.");
  await new Promise<void>((resolveWait, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason ?? new Error("Aborted."));
    };
    timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolveWait();
    }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
};

async function abortable<T>(operation: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return await operation;
  if (signal.aborted) throw signal.reason ?? new Error("Aborted.");
  let onAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason ?? new Error("Aborted."));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
    void operation.catch(() => undefined);
  }
}

async function waitReady(
  read: () => Promise<number>,
  signal: AbortSignal,
  now: () => number,
  wait: GroqRateLimitWait,
): Promise<void> {
  for (;;) {
    if (signal.aborted) throw signal.reason ?? new Error("Aborted.");
    const delayMs = (await read()) - now();
    if (delayMs <= 0) return;
    await wait(delayMs, signal);
  }
}

export class MemoryGroqRateLimitCoordinator implements GroqRateLimitCoordinator {
  readonly kind = "memory" as const;
  private readonly state = new Map<string, number>();
  constructor(
    private readonly now: () => number = Date.now,
    private readonly wait: GroqRateLimitWait = sleep,
  ) {}
  async blockedUntil(scopeId: string, signal?: AbortSignal): Promise<number> {
    if (signal?.aborted) throw signal.reason ?? new Error("Aborted.");
    return this.state.get(boundedScope(scopeId)) ?? 0;
  }
  async extendBlockedUntil(scopeId: string, blockedUntilMs: number, signal?: AbortSignal): Promise<number> {
    if (signal?.aborted) throw signal.reason ?? new Error("Aborted.");
    const key = boundedScope(scopeId);
    const next = Math.max(this.state.get(key) ?? 0, boundedTime(blockedUntilMs));
    this.state.set(key, next);
    return next;
  }
  async waitUntilReady(scopeId: string, signal: AbortSignal): Promise<void> {
    const key = boundedScope(scopeId);
    await waitReady(() => this.blockedUntil(key, signal), signal, this.now, this.wait);
  }
  async close(): Promise<void> {
    this.state.clear();
  }
}

const sharedMemory = new MemoryGroqRateLimitCoordinator();
export function sharedMemoryGroqRateLimitCoordinator(): GroqRateLimitCoordinator {
  return sharedMemory;
}

async function assertReady(pool: Pool): Promise<void> {
  const result = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM schema_migrations WHERE name=$1",
    [migration],
  );
  if (result.rows[0]?.count !== "1") throw new Error(`Groq rate-limit recovery schema is not ready; required migration ${migration} is missing.`);
}

export class PostgresGroqRateLimitCoordinator implements GroqRateLimitCoordinator {
  readonly kind = "postgres" as const;
  private constructor(
    private readonly pool: Pool,
    private readonly now: () => number = Date.now,
    private readonly wait: GroqRateLimitWait = sleep,
  ) {}
  static async migrate(databaseUrl: string): Promise<void> {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
      const existing = await pool.query("SELECT 1 FROM schema_migrations WHERE name=$1", [migration]);
      if ((existing.rowCount ?? 0) === 0) {
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
      await assertReady(pool);
    } finally {
      await pool.end();
    }
  }
  static async connect(
    databaseUrl: string,
    options: { now?: () => number; wait?: GroqRateLimitWait } = {},
  ): Promise<PostgresGroqRateLimitCoordinator> {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await assertReady(pool);
      return new PostgresGroqRateLimitCoordinator(pool, options.now, options.wait);
    } catch (error) {
      await pool.end();
      throw error;
    }
  }
  async blockedUntil(scopeId: string, signal?: AbortSignal): Promise<number> {
    const result = await abortable(this.pool.query<{ blocked_until_ms: string }>(
      "SELECT floor(extract(epoch FROM blocked_until) * 1000)::bigint::text AS blocked_until_ms FROM groq_rate_limit_recovery WHERE scope_id=$1",
      [boundedScope(scopeId)],
    ), signal);
    return result.rows[0] ? Number(result.rows[0].blocked_until_ms) : 0;
  }
  async extendBlockedUntil(scopeId: string, blockedUntilMs: number, signal?: AbortSignal): Promise<number> {
    const result = await abortable(this.pool.query<{ blocked_until_ms: string }>(
      `INSERT INTO groq_rate_limit_recovery(scope_id,blocked_until,updated_at)
       VALUES ($1,to_timestamp($2::double precision / 1000.0),now())
       ON CONFLICT(scope_id) DO UPDATE SET
         blocked_until=GREATEST(groq_rate_limit_recovery.blocked_until,EXCLUDED.blocked_until),
         updated_at=CASE WHEN EXCLUDED.blocked_until > groq_rate_limit_recovery.blocked_until THEN now() ELSE groq_rate_limit_recovery.updated_at END
       RETURNING floor(extract(epoch FROM blocked_until) * 1000)::bigint::text AS blocked_until_ms`,
      [boundedScope(scopeId), boundedTime(blockedUntilMs)],
    ), signal);
    const row = result.rows[0];
    if (!row) throw new Error("Groq rate-limit recovery update returned no state.");
    return Number(row.blocked_until_ms);
  }
  async waitUntilReady(scopeId: string, signal: AbortSignal): Promise<void> {
    const key = boundedScope(scopeId);
    await waitReady(() => this.blockedUntil(key, signal), signal, this.now, this.wait);
  }
  async close(): Promise<void> {
    await this.pool.end();
  }
}

export async function createGroqRateLimitCoordinator(
  databaseUrl: string | undefined,
  options: { migrate?: boolean } = {},
): Promise<GroqRateLimitCoordinator> {
  if (databaseUrl === undefined) return sharedMemoryGroqRateLimitCoordinator();
  if (options.migrate === true) await PostgresGroqRateLimitCoordinator.migrate(databaseUrl);
  return await PostgresGroqRateLimitCoordinator.connect(databaseUrl);
}
