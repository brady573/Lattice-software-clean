import type { FastifyInstance } from "fastify";
import type { RunEvent, RunStatus } from "../domain.js";
import type { RunStore } from "../run-store.js";

const terminalStatuses = new Set<RunStatus>(["COMPLETED", "CANCELLED", "FAILED"]);
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const RETRY_DELAY_MS = 1_000;

export interface RunEventStreamOptions {
  runStore: RunStore;
  pollIntervalMs?: number;
}

function parseLastEventId(value: string | string[] | undefined): number | undefined {
  if (value === undefined) return 0;
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || !/^(0|[1-9]\d*)$/.test(candidate)) return undefined;
  const sequence = Number(candidate);
  return Number.isSafeInteger(sequence) ? sequence : undefined;
}

function encodeEvent(runId: string, event: RunEvent): string {
  return [
    `id: ${event.sequence}`,
    "event: run-progress",
    `data: ${JSON.stringify({ runId, sequence: event.sequence, type: event.type })}`,
    "",
    "",
  ].join("\n");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function registerRunEventStream(app: FastifyInstance, options: RunEventStreamOptions): void {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new Error("Run event stream pollIntervalMs must be a finite positive number.");
  }

  app.get<{ Params: { runId: string } }>("/api/v1/runs/:runId/events/stream", async (request, reply) => {
    const lastEventId = parseLastEventId(request.headers["last-event-id"]);
    if (lastEventId === undefined) {
      return reply.status(400).send({ error: "INVALID_LAST_EVENT_ID" });
    }

    const initial = await options.runStore.get(request.params.runId);
    if (!initial) return reply.status(404).send({ error: "RUN_NOT_FOUND" });

    reply.hijack();
    reply.raw.statusCode = 200;
    reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.write(`retry: ${RETRY_DELAY_MS}\n\n`);

    let disconnected = false;
    reply.raw.once("close", () => {
      disconnected = true;
    });

    let deliveredSequence = lastEventId;
    try {
      while (!disconnected) {
        const run = await options.runStore.get(request.params.runId);
        if (!run) break;

        for (const event of run.events) {
          if (event.sequence <= deliveredSequence) continue;
          reply.raw.write(encodeEvent(run.id, event));
          deliveredSequence = event.sequence;
        }

        if (terminalStatuses.has(run.status)) break;
        await delay(pollIntervalMs);
      }
    } finally {
      if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end();
    }
  });
}
