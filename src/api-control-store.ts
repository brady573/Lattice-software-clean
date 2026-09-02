import { createHash } from "node:crypto";
import type { LatticeRun } from "./domain.js";
import type {
  IntentBoundRunStore,
  RunIntentBindingInput,
  RunSupersessionInput,
  RunSupersessionRecord,
} from "./intent/run-binding.js";
import type { DispatchIntent, RunStore } from "./run-store.js";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function createApiRequestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

export interface ApiIdempotencyInput {
  scopeKey: string;
  httpMethod: string;
  canonicalRoute: string;
  idempotencyKey: string;
  requestHash: string;
  expiresAt: Date;
}

export interface ApiRunSubmissionInput {
  run: LatticeRun;
  dispatch: DispatchIntent;
  idempotency?: ApiIdempotencyInput;
  intentBinding?: RunIntentBindingInput;
}

export interface ApiRunSupersessionInput {
  supersession: RunSupersessionInput;
  dispatch: DispatchIntent;
}

export interface ApiAcceptedRunResponse {
  runId: string;
  status: "CREATED";
}

export interface ApiSupersededRunResponse extends ApiAcceptedRunResponse {
  supersededRunId: string;
  supersessionId: string;
}

export type ApiRunSubmissionResult =
  | { outcome: "created"; response: ApiAcceptedRunResponse }
  | { outcome: "existing"; response: ApiAcceptedRunResponse }
  | { outcome: "conflict" };

export type ApiRunSupersessionResult =
  | { outcome: "superseded"; response: ApiSupersededRunResponse; record: RunSupersessionRecord }
  | { outcome: "replayed"; response: ApiSupersededRunResponse; record: RunSupersessionRecord }
  | { outcome: "stale" };

export interface ApiRunControlStore {
  submitRun(input: ApiRunSubmissionInput): Promise<ApiRunSubmissionResult>;
  supersedeRun(input: ApiRunSupersessionInput): Promise<ApiRunSupersessionResult>;
  close(): Promise<void>;
}

type MemoryIdempotencyRecord = {
  requestHash: string;
  response: ApiAcceptedRunResponse;
  expiresAt: Date;
};

function idempotencyIdentity(input: ApiIdempotencyInput): string {
  return [input.scopeKey, input.httpMethod, input.canonicalRoute, input.idempotencyKey].join("\u001f");
}

function supersededResponse(record: RunSupersessionRecord): ApiSupersededRunResponse {
  return {
    runId: record.successorRunId,
    status: "CREATED",
    supersededRunId: record.predecessorRunId,
    supersessionId: record.supersessionId,
  };
}

/**
 * Fixture-mode API control plane. It provides the same idempotency contract as
 * the durable adapter while Run execution is invoked explicitly by tests or an
 * in-process worker. PostgreSQL is the authoritative durability surface for
 * atomic Run + outbox creation and supersession.
 */
export class MemoryApiRunControlStore implements ApiRunControlStore {
  private readonly records = new Map<string, MemoryIdempotencyRecord>();
  private readonly inflight = new Map<string, Promise<void>>();

  constructor(
    private readonly runStore: RunStore,
    private readonly intentBoundRunStore?: IntentBoundRunStore,
  ) {
    if (intentBoundRunStore && intentBoundRunStore.kind !== "memory") {
      throw new Error("Memory API control requires a memory exact IntentVersion binding store.");
    }
  }

  private async createRun(input: ApiRunSubmissionInput): Promise<void> {
    if (input.intentBinding) {
      if (!this.intentBoundRunStore) {
        throw new Error("Exact IntentVersion-bound Run intake is not configured for this API control store.");
      }
      await this.intentBoundRunStore.create(input.run, input.intentBinding);
      return;
    }
    await this.runStore.create(input.run);
  }

  async submitRun(input: ApiRunSubmissionInput): Promise<ApiRunSubmissionResult> {
    const response: ApiAcceptedRunResponse = { runId: input.run.id, status: "CREATED" };
    if (!input.idempotency) {
      await this.createRun(input);
      return { outcome: "created", response };
    }

    const identity = idempotencyIdentity(input.idempotency);
    const readRecord = (): MemoryIdempotencyRecord | undefined => {
      const record = this.records.get(identity);
      if (!record) return undefined;
      if (record.expiresAt.getTime() <= Date.now()) {
        this.records.delete(identity);
        return undefined;
      }
      return record;
    };

    const existing = readRecord();
    if (existing) {
      return existing.requestHash === input.idempotency.requestHash
        ? { outcome: "existing", response: structuredClone(existing.response) }
        : { outcome: "conflict" };
    }

    const prior = this.inflight.get(identity);
    if (prior) {
      await prior;
      const settled = readRecord();
      if (!settled) throw new Error("API idempotency reservation settled without a response record.");
      return settled.requestHash === input.idempotency.requestHash
        ? { outcome: "existing", response: structuredClone(settled.response) }
        : { outcome: "conflict" };
    }

    const operation = (async () => {
      await this.createRun(input);
      this.records.set(identity, {
        requestHash: input.idempotency!.requestHash,
        response: structuredClone(response),
        expiresAt: new Date(input.idempotency!.expiresAt),
      });
    })();
    this.inflight.set(identity, operation);
    try {
      await operation;
    } finally {
      this.inflight.delete(identity);
    }
    return { outcome: "created", response };
  }

  async supersedeRun(input: ApiRunSupersessionInput): Promise<ApiRunSupersessionResult> {
    if (!this.intentBoundRunStore) {
      throw new Error("Exact IntentVersion-bound Run supersession is not configured for this API control store.");
    }
    const result = await this.intentBoundRunStore.supersede(input.supersession);
    if (result.outcome === "stale") return result;
    return {
      outcome: result.outcome,
      response: supersededResponse(result.record),
      record: result.record,
    };
  }

  async close(): Promise<void> {
    this.records.clear();
    this.inflight.clear();
    if (this.intentBoundRunStore) await this.intentBoundRunStore.close();
  }
}