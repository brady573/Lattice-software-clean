import { randomUUID } from "node:crypto";
import { PostgresOrchestrationStore } from "./postgres-orchestration-store.js";
import {
  processResearchDispatches,
  type ResearchTaskExecutor,
} from "./research-worker.js";

const DEFAULT_POLL_MS = 50;
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_RETRY_DELAY_MS = 1_000;
const DEFAULT_BATCH_SIZE = 10;

export interface ResearchWorkerProcessConfig {
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

export function resolveResearchWorkerProcessConfig(
  env: NodeJS.ProcessEnv = process.env,
): ResearchWorkerProcessConfig {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("Standalone Research worker requires DATABASE_URL; refusing to fall back to in-memory state.");
  }

  const configuredWorkerId = env.LATTICE_RESEARCH_WORKER_ID;
  const workerId = configuredWorkerId === undefined
    ? `lattice-research-worker:${process.pid}:${randomUUID()}`
    : configuredWorkerId.trim();
  if (workerId.length === 0 || workerId.length > 160) {
    throw new Error("LATTICE_RESEARCH_WORKER_ID must contain between 1 and 160 characters when configured.");
  }

  return {
    databaseUrl,
    workerId,
    pollMs: parseInteger(
      env.LATTICE_RESEARCH_WORKER_POLL_MS,
      DEFAULT_POLL_MS,
      "LATTICE_RESEARCH_WORKER_POLL_MS",
      1,
      60_000,
    ),
    leaseMs: parseInteger(
      env.LATTICE_RESEARCH_WORKER_LEASE_MS,
      DEFAULT_LEASE_MS,
      "LATTICE_RESEARCH_WORKER_LEASE_MS",
      1_000,
      300_000,
    ),
    retryDelayMs: parseInteger(
      env.LATTICE_RESEARCH_WORKER_RETRY_DELAY_MS,
      DEFAULT_RETRY_DELAY_MS,
      "LATTICE_RESEARCH_WORKER_RETRY_DELAY_MS",
      0,
      60_000,
    ),
    batchSize: parseInteger(
      env.LATTICE_RESEARCH_WORKER_BATCH_SIZE,
      DEFAULT_BATCH_SIZE,
      "LATTICE_RESEARCH_WORKER_BATCH_SIZE",
      1,
      100,
    ),
  };
}

export interface PollingResearchWorkerLoopOptions {
  pollMs: number;
  poll: () => Promise<void>;
  onError?: (error: unknown) => void;
}

/**
 * Research-process polling lifecycle. Shutdown prevents new polls and waits for
 * an active poll to settle before the owning process closes durable resources.
 */
export class PollingResearchWorkerLoop {
  private timer: NodeJS.Timeout | undefined;
  private activePoll: Promise<void> | undefined;
  private state: "idle" | "running" | "closing" | "closed" = "idle";

  constructor(private readonly options: PollingResearchWorkerLoopOptions) {
    if (!Number.isSafeInteger(options.pollMs) || options.pollMs < 1) {
      throw new Error("Research-worker poll interval must be a positive integer.");
    }
  }

  start(): void {
    if (this.state !== "idle") throw new Error(`Research-worker loop cannot start from ${this.state} state.`);
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

/**
 * Fail-closed default for M3 durable process composition. A separately
 * qualified Work Item must bind an actual research execution driver; absence
 * of one is an operational failure and never an epistemic V36 judgment.
 */
export class UnavailableResearchTaskExecutor implements ResearchTaskExecutor {
  async execute(): Promise<never> {
    throw new Error("No qualified research execution driver is configured for the standalone Research worker.");
  }
}

export interface StandaloneResearchWorkerOptions {
  executor?: ResearchTaskExecutor;
  onPollError?: (error: unknown) => void;
}

export interface StandaloneResearchWorker {
  readonly workerId: string;
  start(): void;
  close(): Promise<void>;
}

/**
 * Compose the durable Research-worker process role without migration authority
 * and without V36 truth authority. The PostgreSQL orchestration adapter is
 * opened with migrate=false, so schema readiness fails closed.
 */
export async function createStandaloneResearchWorker(
  config: ResearchWorkerProcessConfig,
  options: StandaloneResearchWorkerOptions = {},
): Promise<StandaloneResearchWorker> {
  const orchestrationStore = await PostgresOrchestrationStore.connect(config.databaseUrl, { migrate: false });
  const executor = options.executor ?? new UnavailableResearchTaskExecutor();
  const loop = new PollingResearchWorkerLoop({
    pollMs: config.pollMs,
    poll: async () => {
      await processResearchDispatches({
        orchestrationStore,
        executor,
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
      if (closed) throw new Error("Standalone Research worker is already closed.");
      loop.start();
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await loop.close();
      await orchestrationStore.close();
    },
  };
}

/**
 * Own the standalone process lifecycle while allowing one already-qualified
 * ResearchTaskExecutor to be injected by Product composition. Omitting the
 * executor preserves the fail-closed default; this function does not infer or
 * activate provider configuration from environment variables.
 */
export async function runStandaloneResearchWorkerProcess(
  env: NodeJS.ProcessEnv = process.env,
  options: StandaloneResearchWorkerOptions = {},
): Promise<void> {
  const config = resolveResearchWorkerProcessConfig(env);
  const worker = await createStandaloneResearchWorker(config, {
    ...(options.executor === undefined ? {} : { executor: options.executor }),
    onPollError(error): void {
      try {
        options.onPollError?.(error);
      } finally {
        console.error("LATTICE_RESEARCH_WORKER_POLL_FAILED", error);
      }
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
    console.log(`LATTICE_RESEARCH_WORKER_READY workerId=${config.workerId}`);
    const signal = await stopRequested;
    console.log(`LATTICE_RESEARCH_WORKER_STOPPING signal=${signal}`);
    await worker.close();
    console.log(`LATTICE_RESEARCH_WORKER_STOPPED signal=${signal}`);
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    await worker.close();
  }
}
