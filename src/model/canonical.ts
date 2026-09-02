import { createHash } from "node:crypto";
import { ModelProviderError } from "./errors.js";
import type {
  CanonicalModelMessage,
  CanonicalModelOutput,
  CanonicalModelRequest,
  CanonicalModelResponse,
  CanonicalModelToolDefinition,
  CanonicalModelToolInputSchema,
  CanonicalModelToolProperty,
  ProviderMetadataValue,
} from "./types.js";

const limits = Object.freeze({
  modelChars: 128,
  messages: 64,
  messageChars: 64 * 1024,
  tools: 32,
  toolNameChars: 64,
  toolDescriptionChars: 4 * 1024,
  toolProperties: 64,
  outputItems: 64,
  outputTextChars: 256 * 1024,
  toolArgumentBytes: 64 * 1024,
  metadataEntries: 32,
  metadataKeyChars: 64,
  metadataStringChars: 256,
});

const toolNamePattern = /^[A-Za-z0-9_-]+$/;
const roles = new Set(["system", "user", "assistant", "tool"]);
const scalarTypes = new Set(["string", "number", "integer", "boolean"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ownKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value);
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedSet = new Set(allowed);
  const unknown = ownKeys(value).filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) {
    throw new ModelProviderError(
      "invalid_output",
      `${label} contains unsupported field(s): ${unknown.join(", ")}.`,
    );
  }
}

function requireBoundedString(
  value: unknown,
  label: string,
  maxChars: number,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ModelProviderError("invalid_output", `${label} must be a non-empty string.`);
  }
  if (value.length > maxChars) {
    throw new ModelProviderError("invalid_output", `${label} exceeds ${maxChars} characters.`);
  }
  return value;
}

function optionalBoundedString(
  value: unknown,
  label: string,
  maxChars: number,
): string | undefined {
  if (value === undefined) return undefined;
  return requireBoundedString(value, label, maxChars);
}

function validateToolProperty(value: unknown, label: string): CanonicalModelToolProperty {
  if (!isRecord(value)) {
    throw new ModelProviderError("invalid_output", `${label} must be an object.`);
  }
  assertOnlyKeys(value, ["type", "description", "enum"], label);
  if (typeof value.type !== "string" || !scalarTypes.has(value.type)) {
    throw new ModelProviderError("unsupported_capability", `${label}.type is unsupported.`);
  }
  const description = optionalBoundedString(
    value.description,
    `${label}.description`,
    limits.toolDescriptionChars,
  );
  let enumValues: readonly (string | number | boolean)[] | undefined;
  if (value.enum !== undefined) {
    if (!Array.isArray(value.enum) || value.enum.length === 0 || value.enum.length > 64) {
      throw new ModelProviderError("invalid_output", `${label}.enum must contain 1-64 values.`);
    }
    const parsed = value.enum.map((entry) => {
      if (
        typeof entry !== "string"
        && typeof entry !== "number"
        && typeof entry !== "boolean"
      ) {
        throw new ModelProviderError("invalid_output", `${label}.enum contains a non-scalar value.`);
      }
      return entry;
    });
    enumValues = Object.freeze(parsed);
  }
  return Object.freeze({
    type: value.type as CanonicalModelToolProperty["type"],
    ...(description === undefined ? {} : { description }),
    ...(enumValues === undefined ? {} : { enum: enumValues }),
  });
}

function validateToolInputSchema(value: unknown, label: string): CanonicalModelToolInputSchema {
  if (!isRecord(value)) {
    throw new ModelProviderError("invalid_output", `${label} must be an object schema.`);
  }
  assertOnlyKeys(value, ["type", "properties", "required", "additionalProperties"], label);
  if (value.type !== "object") {
    throw new ModelProviderError(
      "unsupported_capability",
      `${label}.type must be "object" in the first canonical contract.`,
    );
  }
  if (!isRecord(value.properties)) {
    throw new ModelProviderError("invalid_output", `${label}.properties must be an object.`);
  }
  const propertyEntries = Object.entries(value.properties);
  if (propertyEntries.length > limits.toolProperties) {
    throw new ModelProviderError(
      "invalid_output",
      `${label}.properties exceeds ${limits.toolProperties} entries.`,
    );
  }
  const properties: Record<string, CanonicalModelToolProperty> = {};
  for (const [name, property] of propertyEntries) {
    requireBoundedString(name, `${label}.property name`, limits.toolNameChars);
    properties[name] = validateToolProperty(property, `${label}.properties.${name}`);
  }

  let required: readonly string[] | undefined;
  if (value.required !== undefined) {
    if (!Array.isArray(value.required) || value.required.length > limits.toolProperties) {
      throw new ModelProviderError("invalid_output", `${label}.required must be a bounded array.`);
    }
    const parsed = value.required.map((entry) =>
      requireBoundedString(entry, `${label}.required item`, limits.toolNameChars)
    );
    if (new Set(parsed).size !== parsed.length) {
      throw new ModelProviderError("invalid_output", `${label}.required contains duplicates.`);
    }
    for (const name of parsed) {
      if (!(name in properties)) {
        throw new ModelProviderError(
          "invalid_output",
          `${label}.required references unknown property ${name}.`,
        );
      }
    }
    required = Object.freeze(parsed);
  }

  if (value.additionalProperties !== undefined && value.additionalProperties !== false) {
    throw new ModelProviderError(
      "unsupported_capability",
      `${label}.additionalProperties must be false when specified.`,
    );
  }

  return Object.freeze({
    type: "object",
    properties: Object.freeze(properties),
    ...(required === undefined ? {} : { required }),
    additionalProperties: false,
  });
}

function validateToolDefinition(value: unknown, index: number): CanonicalModelToolDefinition {
  if (!isRecord(value)) {
    throw new ModelProviderError("invalid_output", `tools[${index}] must be an object.`);
  }
  assertOnlyKeys(value, ["name", "description", "inputSchema"], `tools[${index}]`);
  const name = requireBoundedString(
    value.name,
    `tools[${index}].name`,
    limits.toolNameChars,
  );
  if (!toolNamePattern.test(name)) {
    throw new ModelProviderError(
      "invalid_output",
      `tools[${index}].name contains unsupported characters.`,
    );
  }
  const description = optionalBoundedString(
    value.description,
    `tools[${index}].description`,
    limits.toolDescriptionChars,
  );
  const inputSchema = validateToolInputSchema(
    value.inputSchema,
    `tools[${index}].inputSchema`,
  );
  return Object.freeze({
    name,
    ...(description === undefined ? {} : { description }),
    inputSchema,
  });
}

function validateMessage(value: unknown, index: number): CanonicalModelMessage {
  if (!isRecord(value)) {
    throw new ModelProviderError("invalid_output", `messages[${index}] must be an object.`);
  }
  assertOnlyKeys(value, ["role", "content", "name", "toolCallId"], `messages[${index}]`);
  if (typeof value.role !== "string" || !roles.has(value.role)) {
    throw new ModelProviderError("invalid_output", `messages[${index}].role is invalid.`);
  }
  const content = requireBoundedString(
    value.content,
    `messages[${index}].content`,
    limits.messageChars,
  );
  const name = optionalBoundedString(value.name, `messages[${index}].name`, limits.toolNameChars);
  const toolCallId = optionalBoundedString(
    value.toolCallId,
    `messages[${index}].toolCallId`,
    limits.toolNameChars,
  );
  if (value.role === "tool" && toolCallId === undefined) {
    throw new ModelProviderError(
      "invalid_output",
      `messages[${index}].toolCallId is required for tool messages.`,
    );
  }
  return Object.freeze({
    role: value.role as CanonicalModelMessage["role"],
    content,
    ...(name === undefined ? {} : { name }),
    ...(toolCallId === undefined ? {} : { toolCallId }),
  });
}

export function validateCanonicalModelRequest(value: unknown): CanonicalModelRequest {
  if (!isRecord(value)) {
    throw new ModelProviderError("invalid_output", "Model request must be an object.");
  }
  assertOnlyKeys(
    value,
    ["model", "messages", "tools", "temperature", "maxOutputTokens", "seed"],
    "Model request",
  );

  const model = requireBoundedString(value.model, "model", limits.modelChars);
  if (!Array.isArray(value.messages) || value.messages.length === 0 || value.messages.length > limits.messages) {
    throw new ModelProviderError(
      "invalid_output",
      `messages must contain 1-${limits.messages} items.`,
    );
  }
  const messages = Object.freeze(value.messages.map(validateMessage));

  let tools: readonly CanonicalModelToolDefinition[] | undefined;
  if (value.tools !== undefined) {
    if (!Array.isArray(value.tools) || value.tools.length > limits.tools) {
      throw new ModelProviderError("invalid_output", `tools exceeds ${limits.tools} items.`);
    }
    const parsed = value.tools.map(validateToolDefinition);
    if (new Set(parsed.map((tool) => tool.name)).size !== parsed.length) {
      throw new ModelProviderError("invalid_output", "tools contains duplicate names.");
    }
    tools = Object.freeze(parsed);
  }

  let temperature: number | undefined;
  if (value.temperature !== undefined) {
    if (
      typeof value.temperature !== "number"
      || !Number.isFinite(value.temperature)
      || value.temperature < 0
      || value.temperature > 2
    ) {
      throw new ModelProviderError("invalid_output", "temperature must be between 0 and 2.");
    }
    temperature = value.temperature;
  }

  let maxOutputTokens: number | undefined;
  if (value.maxOutputTokens !== undefined) {
    if (
      !Number.isInteger(value.maxOutputTokens)
      || (value.maxOutputTokens as number) < 1
      || (value.maxOutputTokens as number) > 32_768
    ) {
      throw new ModelProviderError(
        "invalid_output",
        "maxOutputTokens must be an integer between 1 and 32768.",
      );
    }
    maxOutputTokens = value.maxOutputTokens as number;
  }

  let seed: number | undefined;
  if (value.seed !== undefined) {
    if (!Number.isSafeInteger(value.seed)) {
      throw new ModelProviderError("invalid_output", "seed must be a safe integer.");
    }
    seed = value.seed as number;
  }

  return Object.freeze({
    model,
    messages,
    ...(tools === undefined ? {} : { tools }),
    ...(temperature === undefined ? {} : { temperature }),
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    ...(seed === undefined ? {} : { seed }),
  });
}

function validateToolArgumentValue(
  property: CanonicalModelToolProperty,
  value: unknown,
  label: string,
): string | number | boolean {
  let validType = false;
  switch (property.type) {
    case "string":
      validType = typeof value === "string";
      break;
    case "number":
      validType = typeof value === "number" && Number.isFinite(value);
      break;
    case "integer":
      validType = typeof value === "number" && Number.isSafeInteger(value);
      break;
    case "boolean":
      validType = typeof value === "boolean";
      break;
  }
  if (!validType) {
    throw new ModelProviderError("invalid_output", `${label} does not match declared type.`);
  }
  if (property.enum !== undefined && !property.enum.some((entry) => Object.is(entry, value))) {
    throw new ModelProviderError("invalid_output", `${label} is outside the declared enum.`);
  }
  return value as string | number | boolean;
}

function validateToolArguments(
  schema: CanonicalModelToolInputSchema,
  value: unknown,
  label: string,
): Readonly<Record<string, string | number | boolean>> {
  if (!isRecord(value)) {
    throw new ModelProviderError("invalid_output", `${label} must be an object.`);
  }
  const required = new Set(schema.required ?? []);
  for (const name of required) {
    if (!(name in value)) {
      throw new ModelProviderError("invalid_output", `${label}.${name} is required.`);
    }
  }
  const parsed: Record<string, string | number | boolean> = {};
  for (const [name, entry] of Object.entries(value)) {
    const property = schema.properties[name];
    if (property === undefined) {
      throw new ModelProviderError(
        "invalid_output",
        `${label}.${name} is not licensed by the declared tool schema.`,
      );
    }
    parsed[name] = validateToolArgumentValue(property, entry, `${label}.${name}`);
  }
  const serializedBytes = Buffer.byteLength(JSON.stringify(parsed), "utf8");
  if (serializedBytes > limits.toolArgumentBytes) {
    throw new ModelProviderError(
      "invalid_output",
      `${label} exceeds ${limits.toolArgumentBytes} bytes.`,
    );
  }
  return Object.freeze(parsed);
}

function validateOutputItem(
  value: unknown,
  index: number,
  request: CanonicalModelRequest,
): CanonicalModelOutput {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new ModelProviderError("invalid_output", `output[${index}] must be a typed object.`);
  }
  if (value.type === "text") {
    const text = requireBoundedString(
      value.text,
      `output[${index}].text`,
      limits.outputTextChars,
    );
    return Object.freeze({ type: "text", text });
  }
  if (value.type === "tool_call") {
    const id = requireBoundedString(value.id, `output[${index}].id`, limits.toolNameChars);
    const name = requireBoundedString(
      value.name,
      `output[${index}].name`,
      limits.toolNameChars,
    );
    const tool = request.tools?.find((candidate) => candidate.name === name);
    if (tool === undefined) {
      throw new ModelProviderError(
        "invalid_output",
        `output[${index}] proposes undeclared tool ${name}.`,
      );
    }
    const args = validateToolArguments(
      tool.inputSchema,
      value.arguments,
      `output[${index}].arguments`,
    );
    return Object.freeze({ type: "tool_call", id, name, arguments: args });
  }
  throw new ModelProviderError(
    "unsupported_capability",
    `output[${index}].type is unsupported.`,
  );
}

export function validateCanonicalModelResponse(
  value: unknown,
  request: CanonicalModelRequest,
): CanonicalModelResponse {
  if (!isRecord(value)) {
    throw new ModelProviderError("invalid_output", "Model response must be an object.");
  }
  const id = requireBoundedString(value.id, "response.id", 256);
  const model = requireBoundedString(value.model, "response.model", limits.modelChars);
  if (
    !Array.isArray(value.output)
    || value.output.length === 0
    || value.output.length > limits.outputItems
  ) {
    throw new ModelProviderError(
      "invalid_output",
      `response.output must contain 1-${limits.outputItems} items.`,
    );
  }
  const output = Object.freeze(
    value.output.map((item, index) => validateOutputItem(item, index, request)),
  );

  let usage: CanonicalModelResponse["usage"];
  if (isRecord(value.usage)) {
    const inputTokens = value.usage.inputTokens;
    const outputTokens = value.usage.outputTokens;
    if (
      !Number.isSafeInteger(inputTokens)
      || !Number.isSafeInteger(outputTokens)
      || (inputTokens as number) < 0
      || (outputTokens as number) < 0
    ) {
      throw new ModelProviderError("invalid_output", "response.usage is invalid.");
    }
    usage = Object.freeze({
      inputTokens: inputTokens as number,
      outputTokens: outputTokens as number,
    });
  } else if (value.usage !== undefined) {
    throw new ModelProviderError("invalid_output", "response.usage must be an object.");
  }

  // Capability deny: provider-native or authority-like extra fields are intentionally ignored.
  return Object.freeze({
    id,
    model,
    output,
    ...(usage === undefined ? {} : { usage }),
  });
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  const entries = Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, stableValue(entry)]);
  return Object.fromEntries(entries);
}

export function stableModelJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export function canonicalModelRequestIdentity(request: CanonicalModelRequest): string {
  return createHash("sha256").update(stableModelJson(request)).digest("hex");
}

export function sanitizeProviderMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, ProviderMetadataValue>> {
  if (metadata === undefined) return Object.freeze({});
  const entries = Object.entries(metadata).slice(0, limits.metadataEntries);
  const safe: Record<string, ProviderMetadataValue> = {};
  for (const [key, value] of entries) {
    if (key.length === 0 || key.length > limits.metadataKeyChars) continue;
    if (value === null || typeof value === "boolean") {
      safe[key] = value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      safe[key] = value;
    } else if (typeof value === "string") {
      safe[key] = value.slice(0, limits.metadataStringChars);
    }
  }
  return Object.freeze(safe);
}
