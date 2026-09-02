import type { LatticeRun, RunStatus } from "../domain.js";
import type { RunStore } from "../run-store.js";
import type { IntentAuthorityStore } from "./store.js";

export interface RunIntentBindingInput {
  intentScopeId: string;
  intentVersionId: string;
}

export interface RunIntentBinding extends RunIntentBindingInput {
  runId: string;
  boundAt: string;
}

export interface RunSupersessionInput {
  supersessionId: string;
  predecessorRunId: string;
  expectedPredecessorStatus: RunStatus;
  expectedPredecessorVersion: number;
  successorRun: LatticeRun;
  successorBinding: RunIntentBindingInput;
}

export interface RunSupersessionRecord {
  supersessionId: string;
  predecessorRunId: string;
  successorRunId: string;
  intentScopeId: string;
  predecessorIntentVersionId: string;
  successorIntentVersionId: string;
  createdAt: string;
}

export type RunSupersessionResult =
  | { outcome: "superseded"; record: RunSupersessionRecord }
  | { outcome: "replayed"; record: RunSupersessionRecord }
  | { outcome: "stale" };

export interface IntentBoundRunStore {
  readonly kind: "memory" | "postgres";
  create(run: LatticeRun, binding: RunIntentBindingInput): Promise<RunIntentBinding>;
  getBinding(runId: string): Promise<RunIntentBinding | undefined>;
  supersede(input: RunSupersessionInput): Promise<RunSupersessionResult>;
  getSupersession(predecessorRunId: string): Promise<RunSupersessionRecord | undefined>;
  close(): Promise<void>;
}

const terminalRunStatuses = new Set<RunStatus>(["COMPLETED", "CANCELLED", "FAILED"]);

export function assertSupersedableRunStatus(status: RunStatus): void {
  if (terminalRunStatuses.has(status)) {
    throw new Error(`Terminal Run status ${status} cannot be superseded.`);
  }
}

export function assertCanonicalPendingRun(run: LatticeRun): void {
  if (
    run.status !== "CREATED"
    || run.version !== 1
    || run.decision !== null
    || run.explanation !== null
    || run.truthAssessmentIds.length !== 0
    || run.events.length !== 1
    || run.events[0]?.sequence !== 1
    || run.events[0]?.type !== "CREATED"
  ) {
    throw new Error("Exact IntentVersion binding may only create a canonical pending Run.");
  }
}

function supersessionMatchesInput(record: RunSupersessionRecord, input: RunSupersessionInput): boolean {
  return record.predecessorRunId === input.predecessorRunId
    && record.successorRunId === input.successorRun.id
    && record.intentScopeId === input.successorBinding.intentScopeId
    && record.successorIntentVersionId === input.successorBinding.intentVersionId;
}

export async function resolveExactIntentVersion(
  intentStore: IntentAuthorityStore,
  binding: RunIntentBindingInput,
): Promise<void> {
  const version = await intentStore.getVersion(binding.intentVersionId);
  if (!version || version.intentScopeId !== binding.intentScopeId) {
    throw new Error("Run must bind an existing exact IntentVersion in the requested IntentScope.");
  }
}

/**
 * Memory composition for the M5 exact downstream-binding and supersession contracts.
 *
 * Binding resolution happens before Run creation. A material-correction supersession
 * cancels the historical attempt through Run CAS, creates a fresh pending successor,
 * and records immutable old/new exact-version lineage. No decision/truth state is copied.
 */
export class MemoryIntentBoundRunStore implements IntentBoundRunStore {
  readonly kind = "memory" as const;
  private readonly bindings = new Map<string, RunIntentBinding>();
  private readonly supersessionsById = new Map<string, RunSupersessionRecord>();
  private readonly supersessionsByPredecessor = new Map<string, RunSupersessionRecord>();

  constructor(
    private readonly runStore: RunStore,
    private readonly intentStore: IntentAuthorityStore,
  ) {
    if (runStore.kind !== "memory" || intentStore.kind !== "memory") {
      throw new Error("Memory exact Run binding requires memory Run and Intent Authority stores.");
    }
  }

  async create(run: LatticeRun, binding: RunIntentBindingInput): Promise<RunIntentBinding> {
    assertCanonicalPendingRun(run);
    if (this.bindings.has(run.id) || await this.runStore.get(run.id)) {
      throw new Error("Run already exists and cannot be rebound to another IntentVersion.");
    }
    await resolveExactIntentVersion(this.intentStore, binding);

    const record: RunIntentBinding = {
      runId: run.id,
      intentScopeId: binding.intentScopeId,
      intentVersionId: binding.intentVersionId,
      boundAt: new Date().toISOString(),
    };
    await this.runStore.create(run);
    this.bindings.set(run.id, structuredClone(record));
    return structuredClone(record);
  }

  async getBinding(runId: string): Promise<RunIntentBinding | undefined> {
    const binding = this.bindings.get(runId);
    return binding ? structuredClone(binding) : undefined;
  }

  async supersede(input: RunSupersessionInput): Promise<RunSupersessionResult> {
    const replay = this.supersessionsById.get(input.supersessionId);
    if (replay) {
      if (!supersessionMatchesInput(replay, input)) {
        throw new Error("Supersession identity was reused with different Run lineage.");
      }
      return { outcome: "replayed", record: structuredClone(replay) };
    }
    if (this.supersessionsByPredecessor.has(input.predecessorRunId)) {
      throw new Error("Run already has an immutable supersession successor.");
    }

    assertSupersedableRunStatus(input.expectedPredecessorStatus);
    assertCanonicalPendingRun(input.successorRun);
    const predecessor = await this.runStore.get(input.predecessorRunId);
    const predecessorBinding = this.bindings.get(input.predecessorRunId);
    if (
      !predecessor
      || !predecessorBinding
      || predecessor.status !== input.expectedPredecessorStatus
      || predecessor.version !== input.expectedPredecessorVersion
    ) {
      return { outcome: "stale" };
    }
    if (predecessorBinding.intentScopeId !== input.successorBinding.intentScopeId) {
      throw new Error("Material-correction successor must remain in the predecessor IntentScope.");
    }
    if (predecessorBinding.intentVersionId === input.successorBinding.intentVersionId) {
      throw new Error("Material-correction successor must bind a new exact IntentVersion.");
    }
    if (this.bindings.has(input.successorRun.id) || await this.runStore.get(input.successorRun.id)) {
      throw new Error("Successor Run already exists and cannot be rebound.");
    }
    await resolveExactIntentVersion(this.intentStore, input.successorBinding);

    const cancelled = await this.runStore.transition({
      runId: input.predecessorRunId,
      expectedStatus: input.expectedPredecessorStatus,
      expectedVersion: input.expectedPredecessorVersion,
      nextStatus: "CANCELLED",
    });
    if (cancelled.outcome === "stale") return cancelled;

    const successorBinding: RunIntentBinding = {
      runId: input.successorRun.id,
      intentScopeId: input.successorBinding.intentScopeId,
      intentVersionId: input.successorBinding.intentVersionId,
      boundAt: new Date().toISOString(),
    };
    await this.runStore.create(input.successorRun);
    this.bindings.set(input.successorRun.id, structuredClone(successorBinding));

    const record: RunSupersessionRecord = {
      supersessionId: input.supersessionId,
      predecessorRunId: input.predecessorRunId,
      successorRunId: input.successorRun.id,
      intentScopeId: predecessorBinding.intentScopeId,
      predecessorIntentVersionId: predecessorBinding.intentVersionId,
      successorIntentVersionId: input.successorBinding.intentVersionId,
      createdAt: new Date().toISOString(),
    };
    this.supersessionsById.set(record.supersessionId, structuredClone(record));
    this.supersessionsByPredecessor.set(record.predecessorRunId, structuredClone(record));
    return { outcome: "superseded", record: structuredClone(record) };
  }

  async getSupersession(predecessorRunId: string): Promise<RunSupersessionRecord | undefined> {
    const record = this.supersessionsByPredecessor.get(predecessorRunId);
    return record ? structuredClone(record) : undefined;
  }

  async close(): Promise<void> {
    this.bindings.clear();
    this.supersessionsById.clear();
    this.supersessionsByPredecessor.clear();
  }
}
