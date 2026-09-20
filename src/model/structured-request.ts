import { ModelProviderError } from "./errors.js";
import { validateCanonicalModelRequest as validateBaseCanonicalModelRequest } from "./canonical.js";
import type {
  CanonicalJsonObject,
  CanonicalJsonValue,
  CanonicalModelRequest,
  CanonicalModelStructuredOutput,
} from "./types.js";

const MAX_SCHEMA_BYTES = 64 * 1024;
const MAX_SCHEMA_DEPTH = 32;
const MAX_CONTAINER_ENTRIES = 256;
const MAX_STRING_CHARS = 16 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJsonValue(value: unknown, depth: number, label: string): CanonicalJsonValue {
  if (depth > MAX_SCHEMA_DEPTH) {
    throw new ModelProviderError(
      "invalid_output",
      `${label} exceeds the structured-output schema depth limit.`,
    );
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length > MAX_STRING_CHARS) {
      throw new ModelProviderError(
        "invalid_output",
        `${label} contains a string exceeding ${MAX_STRING_CHARS} characters.`,
      );
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ModelProviderError("invalid_output", `${label} contains a non-finite number.`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_CONTAINER_ENTRIES) {
      throw new ModelProviderError(
        "invalid_output",
        `${label} contains more than ${MAX_CONTAINER_ENTRIES} array entries.`,
      );
    }
    return Object.freeze(
      value.map((entry, index) => cloneJsonValue(entry, depth + 1, `${label}[${index}]`)),
    );
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length > MAX_CONTAINER_ENTRIES) {
      throw new ModelProviderError(
        "invalid_output",
        `${label} contains more than ${MAX_CONTAINER_ENTRIES} object entries.`,
      );
    }
    const cloned: Record<string, CanonicalJsonValue> = {};
    for (const [key, entry] of entries) {
      if (key.length === 0 || key.length > 256) {
        throw new ModelProviderError("invalid_output", `${label} contains an invalid property name.`);
      }
      cloned[key] = cloneJsonValue(entry, depth + 1, `${label}.${key}`);
    }
    return Object.freeze(cloned);
  }
  throw new ModelProviderError(
    "invalid_output",
    `${label} must contain only JSON-compatible values.`,
  );
}

function validateStructuredOutput(value: unknown): CanonicalModelStructuredOutput {
  if (!isRecord(value)) {
    throw new ModelProviderError("invalid_output", "structuredOutput must be an object.");
  }
  const keys = Object.keys(value);
  if (keys.some((key) => key !== "type" && key !== "schema")) {
    throw new ModelProviderError(
      "invalid_output",
      "structuredOutput contains unsupported fields.",
    );
  }
  if (value.type !== "json_schema") {
    throw new ModelProviderError(
      "unsupported_capability",
      'structuredOutput.type must be "json_schema".',
    );
  }
  if (!isRecord(value.schema)) {
    throw new ModelProviderError(
      "invalid_output",
      "structuredOutput.schema must be a JSON object.",
    );
  }
  const schema = cloneJsonValue(value.schema, 0, "structuredOutput.schema") as CanonicalJsonObject;
  const serializedBytes = Buffer.byteLength(JSON.stringify(schema), "utf8");
  if (serializedBytes > MAX_SCHEMA_BYTES) {
    throw new ModelProviderError(
      "invalid_output",
      `structuredOutput.schema exceeds ${MAX_SCHEMA_BYTES} bytes.`,
    );
  }
  return Object.freeze({ type: "json_schema", schema });
}

/**
 * Extends the original canonical request contract with one narrow optional
 * structured-output requirement while preserving all existing request validation.
 */
export function validateCanonicalModelRequest(value: unknown): CanonicalModelRequest {
  if (!isRecord(value) || value.structuredOutput === undefined) {
    return validateBaseCanonicalModelRequest(value);
  }

  const structuredOutput = validateStructuredOutput(value.structuredOutput);
  const baseValue = { ...value };
  delete baseValue.structuredOutput;
  const base = validateBaseCanonicalModelRequest(baseValue);
  return Object.freeze({ ...base, structuredOutput });
}
