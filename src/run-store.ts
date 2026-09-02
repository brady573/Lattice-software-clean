import type { LatticeRun, RunStatus, StructuredDecision } from "./domain.js";
import {
  assertTruthSnapshotTransition,
  type TruthSnapshot,
} from "./truth/snapshot.js";
import type { TruthBundle } from "./truth/types.js";

const allowedTransitions: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  CREATED: ["UNDERSTANDING", "CANCELLED", "FAILED"],
  UNDERSTANDING: ["AWAITING_CLARIFICATION", "PLANNING", "CANCELLED", "FAILED"],
  AWAITING_CLARIFICATION: ["UNDERSTANDING", "CANCELLED"],
  PLANNING: ["INVESTIGATING", "CANCELLED", "FAILED"],
  INVESTIGATING: ["VALIDATING", "CANCELLED", "FAILED"],
  VALIDATING: ["INVESTIGATING", "DECIDING", "COMPLETED", "CANCELLED", "FAILED"],
  DECIDING: ["COMPLETED", "CANCELLED", "FAILED"],
  COMPLETED: [],
  CANCELLED: [],
  FAILED: [],
};

export function assertAllowedTransition(expectedStatus: RunStatus, nextStatus: RunStatus): void {
  if (!allowedTransitions[expectedStatus].includes(nextStatus)) {
    throw new Error(`Invalid Run transition: ${expectedStatus} -> ${nextStatus}`);
  }
}

export type DispatchIntent = {
  logicalKey: string;
  queueName: string;
  payload: unknown;
  availableAt?: Date;
};

export type RunTransition = {
  runId: string;
  expectedStatus: RunStatus;
  expectedVersion: number;
  nextStatus: RunStatus;
  dispatch?: DispatchIntent;
  truthSnapshot?: TruthSnapshot;
};

export type RunTransitionResult =
  | { outcome: "advanced"; version: number }
  | { outcome: "stale" };

export interface RunDecisionPersistence {
  runId: string;
  expectedVersion: number;
  decision: StructuredDecision;
}

export interface RunCompletion {
  runId: string;
  expectedVersion: number;
  explanation: string;
}

export interface RunStore {
  readonly kind: "memory" | "postgres";
  create(run: LatticeRun): Promise<void>;
  transition(input: RunTransition): Promise<RunTransitionResult>;
  persistDecision(input: RunDecisionPersistence): Promise<RunTransitionResult>;
  complete(input: RunCompletion): Promise<RunTransitionResult>;
  get(runId: string): Promise<LatticeRun | undefined>;
  getTruthSnapshot(runId: string): Promise<TruthSnapshot | undefined>;
  getTruthBundle(runId: string): Promise<TruthBundle | undefined>;
  close(): Promise<void>;
}

export class MemoryRunStore implements RunStore {
  readonly kind = "memory" as const;
  private readonly runs = new Map<string, LatticeRun>();
  private readonly truthSnapshots = new Map<string, TruthSnapshot>();

  async create(run: LatticeRun): Promise<void> {
    this.runs.set(run.id, structuredClone(run));
  }

  async transition(input: RunTransition): Promise<RunTransitionResult> {
    assertAllowedTransition(input.expectedStatus, input.nextStatus);
    if (input.truthSnapshot) {
      if (input.truthSnapshot.runId !== input.runId) {
        throw new Error("Truth snapshot Run scope does not match transition Run.");
      }
      assertTruthSnapshotTransition(input.expectedStatus, input.nextStatus, input.truthSnapshot);
    }
    const run = this.runs.get(input.runId);
    if (!run || run.status !== input.expectedStatus || run.version !== input.expectedVersion) {
      return { outcome: "stale" };
    }
    run.status = input.nextStatus;
    run.version += 1;
    run.events.push({ sequence: run.events.length + 1, type: input.nextStatus });
    if (input.truthSnapshot) {
      this.truthSnapshots.set(input.runId, structuredClone(input.truthSnapshot));
      run.truthAssessmentIds = input.truthSnapshot.bundle.assessments.map((assessment) => assessment.id);
    }
    return { outcome: "advanced", version: run.version };
  }

  async persistDecision(input: RunDecisionPersistence): Promise<RunTransitionResult> {
    const run = this.runs.get(input.runId);
    if (!run || run.status !== "DECIDING" || run.version !== input.expectedVersion || run.decision !== null) {
      return { outcome: "stale" };
    }
    run.decision = structuredClone(input.decision);
    run.truthAssessmentIds = [...input.decision.truthAssessmentIds];
    run.version += 1;
    return { outcome: "advanced", version: run.version };
  }

  async complete(input: RunCompletion): Promise<RunTransitionResult> {
    const run = this.runs.get(input.runId);
    if (!run || run.status !== "DECIDING" || run.version !== input.expectedVersion || !run.decision) {
      return { outcome: "stale" };
    }
    assertAllowedTransition("DECIDING", "COMPLETED");
    run.status = "COMPLETED";
    run.version += 1;
    run.explanation = input.explanation;
    run.events.push({ sequence: run.events.length + 1, type: "EXPLAINING" });
    run.events.push({ sequence: run.events.length + 1, type: "COMPLETED" });
    return { outcome: "advanced", version: run.version };
  }

  async get(runId: string): Promise<LatticeRun | undefined> {
    const run = this.runs.get(runId);
    return run ? structuredClone(run) : undefined;
  }

  async getTruthSnapshot(runId: string): Promise<TruthSnapshot | undefined> {
    const snapshot = this.truthSnapshots.get(runId);
    return snapshot ? structuredClone(snapshot) : undefined;
  }

  async getTruthBundle(runId: string): Promise<TruthBundle | undefined> {
    const snapshot = await this.getTruthSnapshot(runId);
    return snapshot?.bundle;
  }

  async close(): Promise<void> {
    this.runs.clear();
    this.truthSnapshots.clear();
  }
}
