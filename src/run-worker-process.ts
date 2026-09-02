import { randomUUID } from "node:crypto";
import { PostgresOrchestrationStore } from "./postgres-orchestration-store.js";
import { PostgresRunStore } from "./postgres-run-store.js";
import { processRunDispatches } from "./run-worker.js";
import {
  createDefaultOfflineTruthPipeline,
  type TruthExecutionPipeline,
} from "./truth/execution-pipeline.js";
import { PostgresV36ResearchBridge } from "./v36-research-bridge.js";
import { assertV36ResearchContinuationRoundsReady } from "./v36-research-round-schema.js";

const DEFAULT_POLL_MS = 50;
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_RETRY_DELAY_MS = 1_000;
const DEFAULT_BATCH_SIZE = 10;

export interface RunWorkerProcessConfig {
  databaseUrl: string;
  workerId: string;
  pollMs: number;
  leaseMs: number;
  retryDelayMs: number;
  batchSize: number;
}

function parseInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const raw = value ?? String(fallback);
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || String(parsed) !== raw.trim() || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

export function resolveRunWorkerProcessConfig(
  env: NodeJS.ProcessEnv = process.env,
): RunWorkerProcessConfig {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("Standalone Run worker requires DATABASE_URL; refusing to fall back to in-memory state.");
  }

  const configuredWorkerId = env.LATTICE_RUN_WORKER_ID;
  const workerId = configuredWorkerId === undefined
    ? `lattice-run-worker:${process.pid}:${randomUUID()}`
    : configuredWorkerId.trim();
  if (workerId.length === 0 || workerId.length > 160) {
    throw new Error("LATTICE_RUN_WORKER_ID must contain between 1 and 160 characters when configured.");
  }

  return {
    databaseUrl,
    workerId,
    pollMs: parseInteger(env.LATTICE_RUN_WORKER_POLL_MS, DEFAULT_POLL_MS, "LATTICE_RUN_WORKER_POLL_MS", 1, 60_000),
    leaseMs: parseInteger(env.LATTICE_RUN_WORKER_LEASE_MS, DEFAULT_LEASE_MS, "LATTICE_RUN_WORKER_LEASE_MS", 1_000, 300_000),
    retryDelayMs: parseInteger(
      env.LATTICE_RUN_WORKER_RETRY_DELAY_MS,
      DEFAULT_RETRY_DELAY_MS,
      "LATTICE_RUN_WORKER_RETRY_DELAY_MS",
      0,
      60_000,
    ),
    batchSize: parseInteger(env.LATTICE_RUN_WORKER_BATCH_SIZE, DEFAULT_BATCH_SIZE, "LATTICE_RUN_WORKER_BATCH_SIZE", 1, 100),
  };
}

export interface PollingRunWorkerLoopOptions {
  pollMs: number;
  poll: () => Promise<void>;
  onError?: (error: unknown) => void;
}

export class PollingRunWorkerLoop {
  private timer: NodeJS.Timeout | undefined;
  private activePoll: Promise<void> | undefined;
  private state: "idle" | "running" | "closing" | "closed" = "idle";

  constructor(private readonly options: PollingRunWorkerLoopOptions) {
    if (!Number.isSafeInteger(options.pollMs) || options.pollMs < 1) {
      throw new Error("Run-worker poll interval must be a positive integer.");
    }
  }

  start(): void {
    if (this.state !== "idle") throw new Error(`Run-worker loop cannot start from ${this.state} state.`);
    this.state = "running";
    this.schedule(0);
  }

  private schedule(delayMs: number): void {
    if (this.state !== "running") return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.state !== "running") return;
      const poll = this.pollOnce();
      this.activePoll = poll;
      void poll.finally(() => {
        if (this.activePoll === poll) this.activePoll = undefined;
        if (this.state === "running") this.schedule(this.options.pollMs);
      });
    }, delayMs);
  }

  private async pollOnce(): Promise<void> {
    try {
      await this.options.poll();
    } catch (error) {
      try {
        this.options.onError?.(error);
      } catch {
        // Logging must not terminate or poison the worker lifecycle.
      }
    }
  }

  async close(): Promise<void> {
    if (this.state === "closed") return;
    if (this.state === "idle") {
      this.state = "closed";
      return;
    }

    this.state = "closing";
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.activePoll) await this.activePoll;
    this.state = "closed";
  }
}

export interface StandaloneRunWorkerOptions {
  truthPipeline?: TruthExecutionPipeline;
  onPollError?: (error: unknown) => void;
}

export interface StandaloneRunWorker {
  readonly workerId: string;
  start(): void;
  close(): Promise<void>;
}

/**
 * Compose the durable Run-worker process role without migration authority.
 * Every adapter is opened with migrate=false and the M4 continuation-round
 * readiness check fails closed when the authorized migration process has not
 * prepared the complete schema lineage.
 */
export async function createStandaloneRunWorker(
  config: RunWorkerProcessConfig,
  options: StandaloneRunWorkerOptions = {},
): Promise<StandaloneRunWorker> {
  await assertV36ResearchContinuationRoundsReady(config.databaseUrl);
  const runStore = await PostgresRunStore.connect(config.databaseUrl, { migrate: false });
  let orchestrationStore: PostgresOrchestrationStore | undefined;
  let continuationBridge: PostgresV36ResearchBridge | undefined;
  try {
    orchestrationStore = await PostgresOrchestrationStore.connect(config.databaseUrl, { migrate: false });
    continuationBridge = await PostgresV36ResearchBridge.connect(config.databaseUrl, { migrate: false });
  } catch (error) {
    if (orchestrationStore) await orchestrationStore.close();
    await runStore.close();
    throw error;
  }

  const truthPipeline = options.truthPipeline ?? createDefaultOfflineTruthPipeline();
  const loop = new PollingRunWorkerLoop({
    pollMs: config.pollMs,
    poll: async () => {
      await processRunDispatches({
        runStore,
        orchestrationStore: orchestrationStore!,
        continuationBridge: continuationBridge!,
        truthPipeline,
        workerId: config.workerId,
        now: new Date(),
        leaseMs: config.leaseMs,
        retryDelayMs: config.retryDelayMs,
        limit: config.batchSize,
      });
    },
    ...(options.onPollError === undefined ? {} : { onError: options.onPollError }),
  });

  let closed = false;
  return {
    workerId: config.workerId,
    start(): void {
      if (closed) throw new Error("Standalone Run worker is already closed.");
      loop.start();
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await loop.close();
      try {
        await continuationBridge!.close();
      } finally {
        try {
          await orchestrationStore!.close();
        } finally {
          await runStore.close();
        }
      }
    },
  };
}

export async function runStandaloneRunWorkerProcess(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const config = resolveRunWorkerProcessConfig(env);
  const worker = await createStandaloneRunWorker(config, {
    onPollError(error): void {
      console.error("LATTICE_RUN_WORKER_POLL_FAILED", error);
    },
  });

  let resolveStop: ((signal: NodeJS.Signals) => void) | undefined;
  const stopRequested = new Promise<NodeJS.Signals>((resolve) => {
    resolveStop = resolve;
  });
  const onSigint = (): void => resolveStop?.("SIGINT");
  const onSigterm = (): void => resolveStop?.("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  try {
    worker.start();
    console.log(`LATTICE_RUN_WORKER_READY workerId=${config.workerId}`);
    const signal = await stopRequested;
    console.log(`LATTICE_RUN_WORKER_STOPPING signal=${signal}`);
    await worker.close();
    console.log(`LATTICE_RUN_WORKER_STOPPED signal=${signal}`);
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    await worker.close();
  }
}
