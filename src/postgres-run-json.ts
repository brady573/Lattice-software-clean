import type { LatticeRunRequest, StructuredDecision } from "./domain.js";
import {
  consultationRunRequestSchema,
  runRequestSchema,
} from "./domain.js";
import { parseStructuredDecision } from "./decision/structured-decision.js";

export type PersistedRunJsonField = "request_json" | "decision_json";

export class PersistedRunCorruptionError extends Error {
  constructor(
    readonly runId: string,
    readonly field: PersistedRunJsonField,
    cause: unknown,
  ) {
    super(`Persisted Run ${runId} contains invalid ${field}.`, { cause });
    this.name = "PersistedRunCorruptionError";
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePersistedRequestValue(value: unknown): LatticeRunRequest {
  if (isJsonObject(value) && Object.hasOwn(value, "kind")) {
    if (value.kind !== "consultation") {
      throw new Error("Unsupported persisted Run request discriminator.");
    }
    return consultationRunRequestSchema.parse(value);
  }
  return runRequestSchema.parse(value);
}

export function parsePersistedRunRequest(runId: string, value: unknown): LatticeRunRequest {
  try {
    return parsePersistedRequestValue(value);
  } catch (cause) {
    throw new PersistedRunCorruptionError(runId, "request_json", cause);
  }
}

export function parsePersistedRunDecision(runId: string, value: unknown): StructuredDecision {
  try {
    return parseStructuredDecision(value);
  } catch (cause) {
    throw new PersistedRunCorruptionError(runId, "decision_json", cause);
  }
}
