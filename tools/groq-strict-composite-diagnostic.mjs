import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  GROQ_KNOWLEDGE_SIMPLIFIER_BASE_URL,
  GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
  GroqKnowledgeSimplifierModelProvider,
  GroqKnowledgeSimplifierModelRuntime,
} from '../src/model/groq-knowledge-simplifier.ts';
import { ModelSolandraCognitiveRuntime } from '../src/solandra/cognition.ts';

const apiKey = process.env.GROQ_API_KEY;
assert.ok(apiKey, 'GROQ_API_KEY is required');

const artifactDir = 'artifacts/groq-structured-output-diagnostic';
const maxDiagnosticChars = 64 * 1024;

function asRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function boundedString(value, maxChars = 8 * 1024) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxChars) : null;
}

function boundedFailedGeneration(value) {
  if (value === undefined || value === null) return null;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return {
    chars: text.length,
    sha256: createHash('sha256').update(text).digest('hex'),
    truncated: text.length > maxDiagnosticChars,
    text: text.slice(0, maxDiagnosticChars),
  };
}

function classifyRawResponse(status, raw) {
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Keep malformed provider evidence bounded without attempting repair.
  }
  const root = asRecord(parsed);
  const error = asRecord(root?.error);
  const usage = asRecord(root?.usage);
  return {
    status,
    ok: status >= 200 && status < 300,
    error: error === null ? null : {
      code: boundedString(error.code, 256),
      type: boundedString(error.type, 256),
      param: boundedString(error.param, 512),
      message: boundedString(error.message, 8 * 1024),
      failedGeneration: boundedFailedGeneration(error.failed_generation),
    },
    usage: usage === null ? null : {
      promptTokens: Number.isSafeInteger(usage.prompt_tokens) ? usage.prompt_tokens : null,
      completionTokens: Number.isSafeInteger(usage.completion_tokens) ? usage.completion_tokens : null,
      totalTokens: Number.isSafeInteger(usage.total_tokens) ? usage.total_tokens : null,
    },
    responseModel: boundedString(root?.model, 256),
    responseId: boundedString(root?.id, 512),
  };
}

function clone(value) {
  return structuredClone(value);
}

function nullableAnyOfToTypeUnion(value) {
  if (Array.isArray(value)) return value.map(nullableAnyOfToTypeUnion);
  const record = asRecord(value);
  if (record === null) return value;

  if (Array.isArray(record.anyOf) && record.anyOf.length === 2) {
    const branches = record.anyOf.map((branch) => asRecord(branch));
    const nullIndex = branches.findIndex((branch) => branch?.type === 'null' && Object.keys(branch).length === 1);
    const otherIndex = nullIndex === 0 ? 1 : nullIndex === 1 ? 0 : -1;
    const other = otherIndex >= 0 ? branches[otherIndex] : null;
    if (other !== null && typeof other.type === 'string') {
      const converted = nullableAnyOfToTypeUnion(other);
      const result = { ...converted, type: [other.type, 'null'] };
      if (Array.isArray(result.enum) && !result.enum.includes(null)) {
        result.enum = [...result.enum, null];
      }
      return result;
    }
  }

  const output = {};
  for (const [key, entry] of Object.entries(record)) {
    output[key] = nullableAnyOfToTypeUnion(entry);
  }
  return output;
}

function useSingleStringComposer(schema) {
  const changed = clone(schema);
  const root = asRecord(changed);
  const properties = asRecord(root?.properties);
  const presentation = asRecord(properties?.presentation);
  const presentationBranches = Array.isArray(presentation?.anyOf) ? presentation.anyOf : [];
  const presentationObject = presentationBranches.map(asRecord).find((branch) => branch?.type === 'object');
  const presentationProperties = asRecord(presentationObject?.properties);
  assert.ok(presentationProperties, 'exact composite schema did not expose presentation properties');
  presentationProperties.composerBody = { type: ['string', 'null'] };
  return changed;
}

async function postBody(label, body) {
  const response = await fetch(`${GROQ_KNOWLEDGE_SIMPLIFIER_BASE_URL}/chat/completions`, {
    method: 'POST',
    redirect: 'error',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${apiKey}`,
      'x-lattice-correlation-id': `groq-strict-diagnostic-${label}`,
    },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  return classifyRawResponse(response.status, raw);
}

let exactOutbound = null;
let exactEvidence = null;
const captureFetch = async (url, init) => {
  exactOutbound = JSON.parse(String(init?.body));
  const response = await fetch(url, init);
  const raw = await response.text();
  exactEvidence = classifyRawResponse(response.status, raw);
  return new Response(raw, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
};

const provider = new GroqKnowledgeSimplifierModelProvider({ apiKey, fetchImpl: captureFetch });
const runtime = new GroqKnowledgeSimplifierModelRuntime(provider);
const cognition = new ModelSolandraCognitiveRuntime(runtime, GROQ_KNOWLEDGE_SIMPLIFIER_MODEL);

let exactRuntimeError = null;
try {
  await cognition.interpret({
    conversationId: 'groq-strict-composite-diagnostic',
    messageId: 'groq-strict-composite-diagnostic-message',
    message: 'I’m comparing two ways to keep a small local project recoverable. What tradeoffs should I think about?',
    recentUserMessages: [],
    recentConversation: [],
    governedKnowledge: [],
    governedRecommendations: [],
  });
} catch (error) {
  exactRuntimeError = {
    name: boundedString(error?.name, 256),
    code: boundedString(error?.code, 256),
    message: boundedString(error?.message, 4 * 1024),
    statusCode: Number.isInteger(error?.statusCode) ? error.statusCode : null,
  };
}

assert.ok(exactOutbound, 'failed to capture exact composite outbound request');
assert.ok(exactEvidence, 'failed to capture exact composite provider response');
assert.equal(exactOutbound.model, GROQ_KNOWLEDGE_SIMPLIFIER_MODEL);
assert.equal(exactOutbound.response_format?.type, 'json_schema');
assert.equal(exactOutbound.response_format?.json_schema?.strict, true);
assert.equal(exactOutbound.max_completion_tokens, 4096);

const exactSchema = exactOutbound.response_format.json_schema.schema;
const nullableUnionBody = clone(exactOutbound);
nullableUnionBody.response_format.json_schema.schema = nullableAnyOfToTypeUnion(exactSchema);
const singleStringComposerBody = clone(exactOutbound);
singleStringComposerBody.response_format.json_schema.schema = useSingleStringComposer(exactSchema);

const nullableUnionEvidence = await postBody('nullable-type-union', nullableUnionBody);
const singleStringComposerEvidence = await postBody('single-string-composer', singleStringComposerBody);

const report = {
  subjectSha: process.env.SUBJECT_SOURCE_SHA ?? null,
  model: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
  request: {
    promptMessage: 'I’m comparing two ways to keep a small local project recoverable. What tradeoffs should I think about?',
    strict: exactOutbound.response_format.json_schema.strict,
    maxCompletionTokens: exactOutbound.max_completion_tokens,
    exactSchemaSha256: createHash('sha256').update(JSON.stringify(exactSchema)).digest('hex'),
  },
  variants: {
    exactComposite: {
      evidence: exactEvidence,
      runtimeError: exactRuntimeError,
    },
    nullableTypeUnion: {
      description: 'Convert exact two-branch nullable anyOf nodes to Groq-documented type unions; leave the three-way Composer union unchanged.',
      evidence: nullableUnionEvidence,
    },
    singleStringComposer: {
      description: 'Keep the exact composite schema except Composer body becomes string-or-null instead of string-or-array-or-null.',
      evidence: singleStringComposerEvidence,
    },
  },
  interpretationBoundary: 'Provider qualification evidence only. Schema variations are diagnostic and are not Product requirements.',
};

await mkdir(artifactDir, { recursive: true });
await writeFile(`${artifactDir}/report.json`, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

for (const [name, variant] of Object.entries(report.variants)) {
  const evidence = variant.evidence;
  console.log(JSON.stringify({
    variant: name,
    status: evidence.status,
    errorCode: evidence.error?.code ?? null,
    errorType: evidence.error?.type ?? null,
    errorParam: evidence.error?.param ?? null,
    errorMessage: evidence.error?.message ?? null,
    promptTokens: evidence.usage?.promptTokens ?? null,
    completionTokens: evidence.usage?.completionTokens ?? null,
    failedGenerationSha256: evidence.error?.failedGeneration?.sha256 ?? null,
    failedGenerationChars: evidence.error?.failedGeneration?.chars ?? null,
  }));
}
console.log('GROQ_STRICT_COMPOSITE_DIAGNOSTIC=COMPLETE');
