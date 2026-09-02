import { Pool } from "pg";
import type { LatticeRun } from "../domain.js";

export interface ConversationRunIndexStore {
  readonly kind: "memory" | "postgres";
  record(run: LatticeRun): Promise<void>;
  listRunIds(conversationId: string): Promise<string[]>;
  close(): Promise<void>;
}

export class MemoryConversationRunIndexStore implements ConversationRunIndexStore {
  readonly kind = "memory" as const;
  private readonly runIdsByConversation = new Map<string, string[]>();

  async record(run: LatticeRun): Promise<void> {
    const current = this.runIdsByConversation.get(run.conversationId) ?? [];
    if (!current.includes(run.id)) {
      current.push(run.id);
      this.runIdsByConversation.set(run.conversationId, current);
    }
  }

  async listRunIds(conversationId: string): Promise<string[]> {
    return [...(this.runIdsByConversation.get(conversationId) ?? [])];
  }

  async close(): Promise<void> {
    this.runIdsByConversation.clear();
  }
}

export class PostgresConversationRunIndexStore implements ConversationRunIndexStore {
  readonly kind = "postgres" as const;
  private constructor(private readonly pool: Pool) {}

  static async connect(databaseUrl: string): Promise<PostgresConversationRunIndexStore> {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query("SELECT 1");
      return new PostgresConversationRunIndexStore(pool);
    } catch (error) {
      await pool.end();
      throw error;
    }
  }

  async record(_run: LatticeRun): Promise<void> {
    // PostgreSQL uses the authoritative runs table as the Conversation index.
  }

  async listRunIds(conversationId: string): Promise<string[]> {
    const result = await this.pool.query<{ id: string }>(
      "SELECT id FROM runs WHERE conversation_id=$1 ORDER BY created_at,id",
      [conversationId],
    );
    return result.rows.map((row) => row.id);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
