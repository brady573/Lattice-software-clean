import { ModelProviderError } from "./errors.js";
import type {
  CanonicalModelJsonPrimitive,
  CanonicalModelJsonSchema,
  CanonicalModelJsonSchemaType,
  CanonicalModelStructuredOutput,
} from "./types.js";

const limits = Object.freeze({
  nameChars: 64,
  descriptionChars: 4 * 1024,
  schemaBytes: 64 * 1024,
  depth: 16,
  nodes: 512,
  properties: 128,
  enumValues: 128,
  anyOfBranches: 16,
});

const schemaNamePattern = /^[A-Za-z0-9_-]+$/u;
const schemaTypes = new Set<CanonicalModelJsonSchemaType>([
  "object",
  "array",
  "string",
  "number",
  "integer",
  "boolean",
  "null",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) {
    throw new ModelProviderError(
      "unsupported_capability",
      `${label} contains unsupported JSON Schema field(s): ${unknown.join(", ")}.`,
    );
  }
}

function boundedString(value: unknown, label: string, maxChars: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ModelProviderError("invalid_output", `${label} must be a non-empty string.`);
  }
  if (value.length > maxChars) {
    throw new ModelProviderError("invalid_output", `${label} exceeds ${maxChars} characters.`);
  }
  return value;
}

function optionalDescription(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return boundedString(value, label, limits.descriptionChars);
}

function validatePrimitiveEnum(
  value: unknown,
  type: CanonicalModelJsonSchemaType,
  label: string,
): readonly CanonicalModelJsonPrimitive[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > limits.enumValues) {
    throw new ModelProviderError(
      "invalid_output",
      `${label}.enum must contain 1-${limits.enumValues} primitive values.`,
    );
  }
  const parsed: CanonicalModelJsonPrimitive[] = [];
  for (const entry of value) {
    const valid = entry === null
      ? type === "null"
      : type === "string"
        ? typeof entry === "string"
        : type === "boolean"
          ? typeof entry === "boolean"
          : type === "integer"
            ? typeof entry === "number" && Number.isSafeInteger(entry)
            : type === "number"
              ? typeof entry === "number" && Number.isFinite(entry)
              : false;
    if (!valid) {
      throw new ModelProviderError(
        "invalid_output",
        `${label}.enum values must match declared ${type} type.`,
      );
    }
    parsed.push(entry as CanonicalModelJsonPrimitive);
  }
  return Object.freeze(parsed);
}

interface SchemaBudget {
  nodes: number;
}

function validateSchema(
  value: unknown,
  label: string,
  strict: boolean,
  depth: number,
  budget: SchemaBudget,
): CanonicalModelJsonSchema {
  if (!isRecord(value)) {
    throw new ModelProviderError("invalid_output", `${label} must be a JSON Schema object.`);
  }
  if (depth > limits.depth) {
    throw new ModelProviderError("invalid_output", `${label} exceeds maximum schema depth ${limits.depth}.`);
  }
  budget.nodes += 1;
  if (budget.nodes > limits.nodes) {
    throw new ModelProviderError("invalid_output", `Structured output schema exceeds ${limits.nodes} nodes.`);
  }
  assertOnlyKeys(
    value,
    ["type", "description", "enum", "properties", "required", "additionalProperties", "items", "anyOf"],
    label,
  );
  const description = optionalDescription(value.description, `${label}.description`);

  if (value.anyOf !== undefined) {
    if (
      value.type !== undefined
      || value.enum !== undefined
      || value.properties !== undefined
      || value.required !== undefined
      || value.additionalProperties !== undefined
      || value.items !== undefined
    ) {
      throw new ModelProviderError(
        "invalid_output",
        `${label}.anyOf cannot be combined with another schema shape in the canonical contract.`,
      );
    }
    if (!Array.isArray(value.anyOf) || value.anyOf.length < 2 || value.anyOf.length > limits.anyOfBranches) {
      throw new ModelProviderError(
        "invalid_output",
        `${label}.anyOf must contain 2-${limits.anyOfBranches} schema branches.`,
      );
    }
    const anyOf = Object.freeze(value.anyOf.map((branch, index) =>
      validateSchema(branch, `${label}.anyOf[${index}]`, strict, depth + 1, budget)
    ));
    return Object.freeze({
      ...(description === undefined ? {} : { description }),
      anyOf,
    });
  }

  if (typeof value.type !== "string" || !schemaTypes.has(value.type as CanonicalModelJsonSchemaType)) {
    throw new ModelProviderError("invalid_output", `${label}.type is required and unsupported.`);
  }
  const type = value.type as CanonicalModelJsonSchemaType;
  const enumValues = validatePrimitiveEnum(value.enum, type, label);

  if (type === "object") {
    if (value.items !== undefined || value.enum !== undefined) {
      throw new ModelProviderError("invalid_output", `${label} object schema contains incompatible fields.`);
    }
    if (!isRecord(value.properties)) {
      throw new ModelProviderError("invalid_output", `${label}.properties must be an object.`);
    }
    const propertyEntries = Object.entries(value.properties);
    if (propertyEntries.length > limits.properties) {
      throw new ModelProviderError(
        "invalid_output",
        `${label}.properties exceeds ${limits.properties} entries.`,
      );
    }
    const properties: Record<string, CanonicalModelJsonSchema> = {};
    for (const [name, property] of propertyEntries) {
      boundedString(name, `${label}.property name`, limits.nameChars);
      properties[name] = validateSchema(property, `${label}.properties.${name}`, strict, depth + 1, budget);
    }

    let required: readonly string[] | undefined;
    if (value.required !== undefined) {
      if (!Array.isArray(value.required) || value.required.length > limits.properties) {
        throw new ModelProviderError("invalid_output", `${label}.required must be a bounded array.`);
      }
      const parsed = value.required.map((entry) => boundedString(entry, `${label}.required item`, limits.nameChars));
      if (new Set(parsed).size !== parsed.length) {
        throw new ModelProviderError("invalid_output", `${label}.required contains duplicates.`);
      }
      for (const name of parsed) {
        if (!(name in properties)) {
          throw new ModelProviderError("invalid_output", `${label}.required references unknown property ${name}.`);
        }
      }
      required = Object.freeze(parsed);
    }

    if (value.additionalProperties !== undefined && value.additionalProperties !== false) {
      throw new ModelProviderError(
        "unsupported_capability",
        `${label}.additionalProperties may only be false in the canonical contract.`,
      );
    }
    if (strict) {
      if (value.additionalProperties !== false) {
        throw new ModelProviderError(
          "invalid_output",
          `${label}.additionalProperties must be false for strict structured output.`,
        );
      }
      const requiredSet = new Set(required ?? []);
      if (requiredSet.size !== propertyEntries.length || propertyEntries.some(([name]) => !requiredSet.has(name))) {
        throw new ModelProviderError(
          "invalid_output",
          `${label}.required must list every property for strict structured output.`,
        );
      }
    }

    return Object.freeze({
      type,
      ...(description === undefined ? {} : { description }),
      properties: Object.freeze(properties),
      ...(required === undefined ? {} : { required }),
      ...(value.additionalProperties === false ? { additionalProperties: false as const } : {}),
    });
  }

  if (type === "array") {
    if (
      value.properties !== undefined
      || value.required !== undefined
      || value.additionalProperties !== undefined
      || value.enum !== undefined
    ) {
      throw new ModelProviderError("invalid_output", `${label} array schema contains incompatible fields.`);
    }
    if (value.items === undefined) {
      throw new ModelProviderError("invalid_output", `${label}.items is required for array schemas.`);
    }
    return Object.freeze({
      type,
      ...(description === undefined ? {} : { description }),
      items: validateSchema(value.items, `${label}.items`, strict, depth + 1, budget),
    });
  }

  if (
    value.properties !== undefined
    || value.required !== undefined
    || value.additionalProperties !== undefined
    || value.items !== undefined
  ) {
    throw new ModelProviderError("invalid_output", `${label} scalar schema contains incompatible fields.`);
  }
  return Object.freeze({
    type,
    ...(description === undefined ? {} : { description }),
    ...(enumValues === undefined ? {} : { enum: enumValues }),
  });
}

export function validateCanonicalStructuredOutput(value: unknown): CanonicalModelStructuredOutput {
  if (!isRecord(value)) {
    throw new ModelProviderError("invalid_output", "structuredOutput must be an object.");
  }
  assertOnlyKeys(value, ["requirement", "format", "name", "strict", "schema"], "structuredOutput");
  if (value.requirement !== "REQUIRED") {
    throw new ModelProviderError(
      "unsupported_capability",
      "structuredOutput.requirement must be REQUIRED in the canonical contract.",
    );
  }
  if (value.format !== "JSON_SCHEMA") {
    throw new ModelProviderError(
      "unsupported_capability",
      "structuredOutput.format must be JSON_SCHEMA in the canonical contract.",
    );
  }
  const name = boundedString(value.name, "structuredOutput.name", limits.nameChars);
  if (!schemaNamePattern.test(name)) {
    throw new ModelProviderError(
      "invalid_output",
      "structuredOutput.name contains unsupported characters.",
    );
  }
  if (typeof value.strict !== "boolean") {
    throw new ModelProviderError("invalid_output", "structuredOutput.strict must be boolean.");
  }
  const schema = validateSchema(value.schema, "structuredOutput.schema", value.strict, 0, { nodes: 0 });
  if (Buffer.byteLength(JSON.stringify(schema), "utf8") > limits.schemaBytes) {
    throw new ModelProviderError(
      "invalid_output",
      `structuredOutput.schema exceeds ${limits.schemaBytes} bytes.`,
    );
  }
  return Object.freeze({
    requirement: "REQUIRED" as const,
    format: "JSON_SCHEMA" as const,
    name,
    strict: value.strict,
    schema,
  });
}

function primitiveMatches(type: CanonicalModelJsonSchemaType, value: unknown): boolean {
  switch (type) {
    case "string": return typeof value === "string";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "integer": return typeof value === "number" && Number.isSafeInteger(value);
    case "boolean": return typeof value === "boolean";
    case "null": return value === null;
    case "object": return isRecord(value);
    case "array": return Array.isArray(value);
  }
}

function valueMatchesSchema(value: unknown, schema: CanonicalModelJsonSchema): boolean {
  if (schema.anyOf !== undefined) {
    return schema.anyOf.some((branch) => valueMatchesSchema(value, branch));
  }
  if (schema.type === undefined || !primitiveMatches(schema.type, value)) return false;
  if (schema.enum !== undefined && !schema.enum.some((entry) => Object.is(entry, value))) return false;

  if (schema.type === "object") {
    if (!isRecord(value) || schema.properties === undefined) return false;
    const required = new Set(schema.required ?? []);
    if ([...required].some((name) => !(name in value))) return false;
    for (const [name, entry] of Object.entries(value)) {
      const property = schema.properties[name];
      if (property === undefined) return schema.additionalProperties !== false;
      if (!valueMatchesSchema(entry, property)) return false;
    }
    return true;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value) || schema.items === undefined) return false;
    return value.every((entry) => valueMatchesSchema(entry, schema.items!));
  }
  return true;
}

export function validateStructuredOutputText(
  text: string,
  contract: CanonicalModelStructuredOutput,
): void {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new ModelProviderError(
      "invalid_output",
      "Required structured model output was not valid JSON.",
      { cause: error },
    );
  }
  if (!valueMatchesSchema(value, contract.schema)) {
    throw new ModelProviderError(
      "invalid_output",
      "Required structured model output did not conform to the canonical JSON schema.",
    );
  }
}
