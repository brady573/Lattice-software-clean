from pathlib import Path

ROOT = Path.cwd()


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected exactly one match in {path}, found {count}: {old[:120]!r}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


write("src/solandra/action-preparer.ts", r'''import { z } from "zod";
import { ModelProviderError } from "../model/errors.js";
import type { ModelRuntime } from "../model/runtime.js";
import type {
  CanonicalModelRequest,
  ModelInvocationProvenance,
} from "../model/types.js";
import type { PreparedResourceBasis } from "../outcome.js";
import type { SolandraGovernedKnowledgeContext } from "./cognition.js";

export interface SolandraActionPreparationInput {
  readonly conversationId: string;
  readonly runId: string;
  readonly intentVersionId: string;
  readonly userMessageId: string;
  readonly userMessage: string;
  readonly authoritativeObjective: string;
  readonly knowledge: readonly SolandraGovernedKnowledgeContext[];
}

export type SolandraActionPreparationResult =
  | Readonly<{
    status: "PREPARED";
    body: string;
    basis: PreparedResourceBasis[];
    preservedUncertainties: string[];
  }>
  | Readonly<{
    status: "INSUFFICIENT_BASIS" | "FIDELITY_REJECTED";
    reason: string;
  }>;

export interface SolandraActionPreparationRuntimeResult {
  readonly result: SolandraActionPreparationResult;
  readonly generationProvenance: ModelInvocationProvenance;
  readonly groundingProvenance: ModelInvocationProvenance | null;
}

export interface SolandraActionPreparer {
  prepare(input: SolandraActionPreparationInput): Promise<SolandraActionPreparationRuntimeResult>;
}

type CallableModelRuntime = Pick<ModelRuntime, "call">;

const basisSchema = z.object({
  knowledgeId: z.string().min(1).max(128),
  claimIds: z.array(z.string().min(1).max(300)).min(1).max(32),
}).strict();

const generationSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("PREPARED"),
    body: z.string().min(1).max(8_000),
    basis: z.array(basisSchema).max(16),
  }).strict(),
  z.object({
    status: z.literal("INSUFFICIENT_BASIS"),
    reason: z.string().min(1).max(2_000),
    body: z.null(),
    basis: z.array(basisSchema).max(0),
  }).strict(),
]);

const groundingSchema = z.object({
  status: z.enum(["GROUNDED", "UNSUPPORTED"]),
  unsupportedExternalPremises: z.array(z.string().min(1).max(2_000)).max(16),
  materialUncertaintyPreserved: z.boolean(),
  authorityBoundaryPreserved: z.boolean(),
}).strict();

function parseJsonObject(text: string, label: string): unknown {
  const trimmed = text.trim();
  const unfenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed)?.[1] ?? trimmed;
  try {
    return JSON.parse(unfenced);
  } catch (error) {
    throw new ModelProviderError(
      "invalid_output",
      `Solandra ${label} returned malformed JSON.`,
      { cause: error },
    );
  }
}

function knowledgePrompt(knowledge: readonly SolandraGovernedKnowledgeContext[]): string {
  if (knowledge.length === 0) return "No governed Knowledge is available for this preparation.";
  return knowledge.map((item) => [
    `Knowledge ID: ${item.knowledgeId}`,
    `Knowledge objective: ${item.objective}`,
    "Governed findings:",
    ...item.findings.map((finding) =>
      `[${finding.claimId}] status=${finding.status}; text=${finding.text}`),
    `Known uncertainties: ${item.uncertainties.join(" | ") || "none"}`,
  ].join("\n")).join("\n\n");
}

function generationRequest(model: string, input: SolandraActionPreparationInput): CanonicalModelRequest {
  return {
    model,
    messages: [
      {
        role: "system",
        content: [
          "You are Solandra preparing one editable message for the USER. This is preparation only, not authorization or execution.",
          "Write material that directly serves the USER's requested message purpose and format. Do not output a generic objective/findings wrapper.",
          "You may rely only on the exact USER-authored/current-authoritative material supplied below and on supplied governed Knowledge findings.",
          "Any governed factual finding used in the message must be listed in basis with its exact Knowledge ID and exact claim ID. Do not invent, repair, or infer IDs.",
          "Do not add names, dates, quantities, causes, events, promises, attachments, legal conclusions, outcomes, or other externally factual premises absent from the allowed material.",
          "Ordinary drafting language such as greetings, requests, questions, and thanks does not need a Knowledge basis.",
          "Preserve materially relevant uncertainty or conflict rather than converting it to certainty.",
          "Never claim that Lattice, Solandra, or the Product sent, submitted, booked, purchased, applied, executed, or authorized the message or any external action.",
          "Do not mention internal IDs, runs, providers, models, V36, workflow stages, or authorization machinery in the message body.",
          "If a useful faithful message cannot be prepared from the allowed material, return INSUFFICIENT_BASIS rather than inventing content.",
          "Return exactly one top-level JSON object and no prose.",
          "For success: {\"status\":\"PREPARED\",\"body\":\"...\",\"basis\":[{\"knowledgeId\":\"...\",\"claimIds\":[\"...\"]}]}.",
          "For failure: {\"status\":\"INSUFFICIENT_BASIS\",\"reason\":\"...\",\"body\":null,\"basis\":[]}.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          "Requested resource format: editable message",
          `Current authoritative USER objective: ${input.authoritativeObjective}`,
          `Current exact USER request: ${input.userMessage}`,
          "Governed Knowledge available for optional factual support:",
          knowledgePrompt(input.knowledge),
        ].join("\n\n"),
      },
    ],
    temperature: 0,
    maxOutputTokens: 1_800,
    seed: 0,
  };
}

function groundingRequest(
  model: string,
  input: SolandraActionPreparationInput,
  body: string,
  selected: readonly SolandraGovernedKnowledgeContext[],
): CanonicalModelRequest {
  return {
    model,
    messages: [
      {
        role: "system",
        content: [
          "You are a bounded grounding verifier for a prepared USER message. Verification is not truth authority and cannot create facts, USER intent, authorization, or execution.",
          "Check the draft only against the exact authoritative USER material and the explicitly selected governed Knowledge below.",
          "Mark UNSUPPORTED if the draft contains any externally factual premise not supported by that material. Greetings, requests, questions, preferences, and thanks are not external factual premises.",
          "materialUncertaintyPreserved is true only when any uncertainty/conflict that materially qualifies a selected finding remains faithfully represented wherever the draft relies on that finding.",
          "authorityBoundaryPreserved is false if the draft represents Lattice/Solandra as having sent, submitted, booked, purchased, applied, executed, or authorized an external action, or grants external-action permission not supplied by the USER.",
          "Return exactly JSON: {\"status\":\"GROUNDED|UNSUPPORTED\",\"unsupportedExternalPremises\":[\"...\"],\"materialUncertaintyPreserved\":boolean,\"authorityBoundaryPreserved\":boolean} and no prose.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `Prepared draft: ${body}`,
          `Current authoritative USER objective: ${input.authoritativeObjective}`,
          `Current exact USER request: ${input.userMessage}`,
          "Explicitly selected governed Knowledge basis:",
          knowledgePrompt(selected),
        ].join("\n\n"),
      },
    ],
    temperature: 0,
    maxOutputTokens: 800,
    seed: 0,
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function validateBasis(
  requested: readonly z.infer<typeof basisSchema>[],
  knowledge: readonly SolandraGovernedKnowledgeContext[],
): { basis: PreparedResourceBasis[]; selected: SolandraGovernedKnowledgeContext[] } | null {
  const available = new Map(knowledge.map((item) => [item.knowledgeId, item]));
  const merged = new Map<string, Set<string>>();
  for (const entry of requested) {
    const item = available.get(entry.knowledgeId);
    if (!item) return null;
    const availableClaims = new Set(item.findings.map((finding) => finding.claimId));
    const claims = merged.get(entry.knowledgeId) ?? new Set<string>();
    for (const claimId of entry.claimIds) {
      if (!availableClaims.has(claimId)) return null;
      claims.add(claimId);
    }
    merged.set(entry.knowledgeId, claims);
  }
  const basis = [...merged.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([knowledgeId, claimIds]) => ({ knowledgeId, claimIds: [...claimIds].sort() }));
  const selected = basis.map((entry) => available.get(entry.knowledgeId)!).filter(Boolean);
  return { basis, selected };
}

export class ModelSolandraActionPreparer implements SolandraActionPreparer {
  constructor(
    private readonly runtime: CallableModelRuntime,
    private readonly model: string,
  ) {
    if (!model.trim()) throw new Error("Solandra Action Preparation model must be non-empty.");
  }

  async prepare(input: SolandraActionPreparationInput): Promise<SolandraActionPreparationRuntimeResult> {
    const generated = await this.runtime.call(generationRequest(this.model, input), {
      correlationId: `solandra-action-prepare:${input.runId}:${input.userMessageId}`,
      idempotencyKey: `PREPARED_MESSAGE:${input.intentVersionId}:${input.userMessageId}`,
      maxAttempts: 1,
    });
    const generationProvenance = generated.audit.invocationProvenance;
    if (generated.response.output.length !== 1 || generated.response.output[0]?.type !== "text") {
      return Object.freeze({
        result: { status: "FIDELITY_REJECTED", reason: "Prepared material did not return one text result." },
        generationProvenance,
        groundingProvenance: null,
      });
    }
    const parsed = generationSchema.parse(parseJsonObject(
      generated.response.output[0].text,
      "Action Preparation generation",
    ));
    if (parsed.status === "INSUFFICIENT_BASIS") {
      return Object.freeze({
        result: { status: "INSUFFICIENT_BASIS", reason: parsed.reason },
        generationProvenance,
        groundingProvenance: null,
      });
    }

    const validated = validateBasis(parsed.basis, input.knowledge);
    if (!validated) {
      return Object.freeze({
        result: {
          status: "FIDELITY_REJECTED",
          reason: "Prepared material referenced Knowledge or claims outside the supplied governed basis.",
        },
        generationProvenance,
        groundingProvenance: null,
      });
    }

    const grounded = await this.runtime.call(
      groundingRequest(this.model, input, parsed.body, validated.selected),
      {
        correlationId: `solandra-action-ground:${input.runId}:${input.userMessageId}`,
        idempotencyKey: `PREPARED_MESSAGE_GROUND:${input.intentVersionId}:${input.userMessageId}`,
        maxAttempts: 1,
      },
    );
    const groundingProvenance = grounded.audit.invocationProvenance;
    if (grounded.response.output.length !== 1 || grounded.response.output[0]?.type !== "text") {
      return Object.freeze({
        result: { status: "FIDELITY_REJECTED", reason: "Prepared material could not be grounded faithfully." },
        generationProvenance,
        groundingProvenance,
      });
    }
    const verification = groundingSchema.parse(parseJsonObject(
      grounded.response.output[0].text,
      "Action Preparation grounding",
    ));
    if (
      verification.status !== "GROUNDED"
      || verification.unsupportedExternalPremises.length > 0
      || !verification.materialUncertaintyPreserved
      || !verification.authorityBoundaryPreserved
    ) {
      return Object.freeze({
        result: {
          status: "FIDELITY_REJECTED",
          reason: "Prepared material could not be kept within the established USER/Knowledge and authority boundaries.",
        },
        generationProvenance,
        groundingProvenance,
      });
    }

    return Object.freeze({
      result: {
        status: "PREPARED",
        body: parsed.body.trim(),
        basis: validated.basis,
        preservedUncertainties: unique(validated.selected.flatMap((item) => [...item.uncertainties])),
      },
      generationProvenance,
      groundingProvenance,
    });
  }
}
''')

write("src/action-preparation/prepared-resource-store.ts", r'''import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import type { PreparedResource, PreparedResourceBasis } from "../outcome.js";

const migration = "035_prepared_resources.sql" as const;

export interface PreparedResourceRecord {
  resourceId: string;
  conversationId: string;
  runId: string;
  intentScopeId: string;
  intentVersionId: string;
  sourceMessageId: string;
  kind: "PREPARED_MESSAGE";
  title: string;
  body: string;
  basis: PreparedResourceBasis[];
  knowledgeIds: string[];
  claimIds: string[];
  preservedUncertainties: string[];
  editable: true;
  executionAuthorized: false;
  createdAt: string;
}

export interface PreparedResourceStore {
  readonly kind: "memory" | "postgres";
  putPreparedResource(record: PreparedResourceRecord): Promise<PreparedResourceRecord>;
  getPreparedResource(resourceId: string): Promise<PreparedResourceRecord | undefined>;
  getPreparedResourceByRunId(runId: string): Promise<PreparedResourceRecord | undefined>;
  close(): Promise<void>;
}

function stableId(prefix: string, ...parts: string[]): string {
  const digest = createHash("sha256").update(parts.join("\u001f")).digest("hex");
  return `${prefix}_${digest.slice(0, 40)}`;
}

function bounded(value: string, label: string, max = 8_000): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new Error(`${label} must contain between 1 and ${max} non-whitespace characters.`);
  }
  return normalized;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`Persisted ${label} is invalid.`);
  }
  return [...value];
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function normalizeBasis(basis: readonly PreparedResourceBasis[]): PreparedResourceBasis[] {
  const byKnowledge = new Map<string, Set<string>>();
  for (const entry of basis) {
    const knowledgeId = bounded(entry.knowledgeId, "basis knowledgeId", 128);
    if (entry.claimIds.length === 0) {
      throw new Error("A PreparedResource Knowledge basis entry requires at least one exact claim reference.");
    }
    const claims = byKnowledge.get(knowledgeId) ?? new Set<string>();
    for (const claimId of entry.claimIds) claims.add(bounded(claimId, "basis claimId", 300));
    byKnowledge.set(knowledgeId, claims);
  }
  return [...byKnowledge.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([knowledgeId, claimIds]) => ({ knowledgeId, claimIds: [...claimIds].sort() }));
}

function dateOrThrow(value: string, label: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error(`${label} must be an ISO-compatible date.`);
  return date.toISOString();
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function sameRecord(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function buildPreparedResourceRecord(
  input: Omit<PreparedResourceRecord, "resourceId" | "knowledgeIds" | "claimIds" | "editable" | "executionAuthorized">,
): PreparedResourceRecord {
  const runId = bounded(input.runId, "runId", 200);
  const intentVersionId = bounded(input.intentVersionId, "intentVersionId", 200);
  const sourceMessageId = bounded(input.sourceMessageId, "sourceMessageId", 200);
  const basis = normalizeBasis(input.basis);
  return Object.freeze({
    resourceId: stableId("prepared_resource", runId, intentVersionId, sourceMessageId),
    conversationId: bounded(input.conversationId, "conversationId", 128),
    runId,
    intentScopeId: bounded(input.intentScopeId, "intentScopeId", 200),
    intentVersionId,
    sourceMessageId,
    kind: "PREPARED_MESSAGE",
    title: bounded(input.title, "title", 300),
    body: bounded(input.body, "body", 8_000),
    basis,
    knowledgeIds: basis.map((entry) => entry.knowledgeId),
    claimIds: unique(basis.flatMap((entry) => entry.claimIds)),
    preservedUncertainties: unique(input.preservedUncertainties.map((item) => bounded(item, "preserved uncertainty", 2_000))),
    editable: true,
    executionAuthorized: false,
    createdAt: dateOrThrow(input.createdAt, "createdAt"),
  });
}

export function preparedResourceFromRecord(record: PreparedResourceRecord): PreparedResource {
  return {
    kind: record.kind,
    title: record.title,
    body: record.body,
    editable: true,
    executionAuthorized: false,
    basis: clone(record.basis),
    preservedUncertainties: [...record.preservedUncertainties],
  };
}

export class MemoryPreparedResourceStore implements PreparedResourceStore {
  readonly kind = "memory" as const;
  private readonly records = new Map<string, PreparedResourceRecord>();
  private readonly byRun = new Map<string, string>();

  async putPreparedResource(record: PreparedResourceRecord): Promise<PreparedResourceRecord> {
    const existing = this.records.get(record.resourceId);
    if (existing) {
      if (!sameRecord(existing, record)) throw new Error("PreparedResource identity cannot be rebound to different state.");
      return clone(existing);
    }
    const runResource = this.byRun.get(record.runId);
    if (runResource && runResource !== record.resourceId) {
      throw new Error("A completed preparation Run cannot establish multiple PreparedResource identities.");
    }
    this.records.set(record.resourceId, clone(record));
    this.byRun.set(record.runId, record.resourceId);
    return clone(record);
  }

  async getPreparedResource(resourceId: string): Promise<PreparedResourceRecord | undefined> {
    const value = this.records.get(resourceId);
    return value ? clone(value) : undefined;
  }

  async getPreparedResourceByRunId(runId: string): Promise<PreparedResourceRecord | undefined> {
    const id = this.byRun.get(runId);
    return id ? await this.getPreparedResource(id) : undefined;
  }

  async close(): Promise<void> {
    this.records.clear();
    this.byRun.clear();
  }
}

type PreparedResourceRow = {
  resource_id: string;
  conversation_id: string;
  run_id: string;
  intent_scope_id: string;
  intent_version_id: string;
  source_message_id: string;
  resource_kind: string;
  title: string;
  body: string;
  basis: unknown;
  knowledge_ids: unknown;
  claim_ids: unknown;
  preserved_uncertainties: unknown;
  editable: boolean;
  execution_authorized: boolean;
  created_at: Date | string;
};

function persistedBasis(value: unknown): PreparedResourceBasis[] {
  if (!Array.isArray(value)) throw new Error("Persisted PreparedResource basis is invalid.");
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Persisted PreparedResource basis entry is invalid.");
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.knowledgeId !== "string") throw new Error("Persisted PreparedResource Knowledge ID is invalid.");
    return { knowledgeId: record.knowledgeId, claimIds: stringArray(record.claimIds, "PreparedResource basis claim IDs") };
  });
}

function mapRow(row: PreparedResourceRow): PreparedResourceRecord {
  if (row.resource_kind !== "PREPARED_MESSAGE") throw new Error("Persisted PreparedResource kind is unsupported.");
  if (row.editable !== true) throw new Error("Persisted PreparedResource must remain editable.");
  if (row.execution_authorized !== false) throw new Error("Persisted PreparedResource cannot authorize execution.");
  return {
    resourceId: row.resource_id,
    conversationId: row.conversation_id,
    runId: row.run_id,
    intentScopeId: row.intent_scope_id,
    intentVersionId: row.intent_version_id,
    sourceMessageId: row.source_message_id,
    kind: "PREPARED_MESSAGE",
    title: row.title,
    body: row.body,
    basis: persistedBasis(row.basis),
    knowledgeIds: stringArray(row.knowledge_ids, "PreparedResource knowledge IDs"),
    claimIds: stringArray(row.claim_ids, "PreparedResource claim IDs"),
    preservedUncertainties: stringArray(row.preserved_uncertainties, "PreparedResource preserved uncertainties"),
    editable: true,
    executionAuthorized: false,
    createdAt: dateOrThrow(row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at, "created_at"),
  };
}

async function applyMigration(pool: Pool): Promise<void> {
  await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const existing = await pool.query<{ name: string }>("SELECT name FROM schema_migrations WHERE name=$1", [migration]);
  if ((existing.rowCount ?? 0) > 0) return;
  const sql = await readFile(resolve(process.cwd(), "migrations", migration), "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [migration]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function assertReady(pool: Pool): Promise<void> {
  const result = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM schema_migrations WHERE name=$1", [migration]);
  if (result.rows[0]?.count !== "1") throw new Error(`PreparedResource schema is not ready; required migration ${migration} is missing.`);
}

const columns = "resource_id,conversation_id,run_id,intent_scope_id,intent_version_id,source_message_id,resource_kind,title,body,basis,knowledge_ids,claim_ids,preserved_uncertainties,editable,execution_authorized,created_at";

export class PostgresPreparedResourceStore implements PreparedResourceStore {
  readonly kind = "postgres" as const;
  private constructor(private readonly pool: Pool) {}

  static async migrate(databaseUrl: string): Promise<void> {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query("SELECT 1");
      await applyMigration(pool);
      await assertReady(pool);
    } finally {
      await pool.end();
    }
  }

  static async connect(databaseUrl: string): Promise<PostgresPreparedResourceStore> {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query("SELECT 1");
      await assertReady(pool);
      return new PostgresPreparedResourceStore(pool);
    } catch (error) {
      await pool.end();
      throw error;
    }
  }

  async putPreparedResource(record: PreparedResourceRecord): Promise<PreparedResourceRecord> {
    const result = await this.pool.query<PreparedResourceRow>(
      `INSERT INTO prepared_resources(${columns})
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14,$15,$16)
       ON CONFLICT(resource_id) DO NOTHING
       RETURNING ${columns}`,
      [
        record.resourceId,
        record.conversationId,
        record.runId,
        record.intentScopeId,
        record.intentVersionId,
        record.sourceMessageId,
        record.kind,
        record.title,
        record.body,
        JSON.stringify(record.basis),
        JSON.stringify(record.knowledgeIds),
        JSON.stringify(record.claimIds),
        JSON.stringify(record.preservedUncertainties),
        true,
        false,
        record.createdAt,
      ],
    );
    if ((result.rowCount ?? 0) > 0) return mapRow(result.rows[0]!);
    const existing = await this.getPreparedResource(record.resourceId);
    if (!existing) throw new Error("PreparedResource insert lost its persisted identity.");
    if (!sameRecord(existing, record)) throw new Error("PreparedResource identity cannot be rebound to different state.");
    return existing;
  }

  async getPreparedResource(resourceId: string): Promise<PreparedResourceRecord | undefined> {
    const result = await this.pool.query<PreparedResourceRow>(`SELECT ${columns} FROM prepared_resources WHERE resource_id=$1`, [resourceId]);
    return result.rows[0] ? mapRow(result.rows[0]) : undefined;
  }

  async getPreparedResourceByRunId(runId: string): Promise<PreparedResourceRecord | undefined> {
    const result = await this.pool.query<PreparedResourceRow>(`SELECT ${columns} FROM prepared_resources WHERE run_id=$1`, [runId]);
    return result.rows[0] ? mapRow(result.rows[0]) : undefined;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
''')

write("migrations/035_prepared_resources.sql", r'''CREATE TABLE prepared_resources (
  resource_id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  run_id uuid NOT NULL UNIQUE REFERENCES runs(id) ON DELETE CASCADE,
  intent_scope_id text NOT NULL,
  intent_version_id text NOT NULL,
  source_message_id text NOT NULL,
  resource_kind text NOT NULL CHECK (resource_kind = 'PREPARED_MESSAGE'),
  title text NOT NULL,
  body text NOT NULL,
  basis jsonb NOT NULL,
  knowledge_ids jsonb NOT NULL,
  claim_ids jsonb NOT NULL,
  preserved_uncertainties jsonb NOT NULL,
  editable boolean NOT NULL DEFAULT true CHECK (editable = true),
  execution_authorized boolean NOT NULL DEFAULT false CHECK (execution_authorized = false),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(basis) = 'array'),
  CHECK (jsonb_typeof(knowledge_ids) = 'array'),
  CHECK (jsonb_typeof(claim_ids) = 'array'),
  CHECK (jsonb_typeof(preserved_uncertainties) = 'array')
);

CREATE INDEX prepared_resources_conversation_created_idx
  ON prepared_resources(conversation_id, created_at, resource_id);
''')

replace_once(
    "src/intent/consultation-interpreter.ts",
    '''export interface ConsultationInterpreter {\n  interpret(input: ConsultationInterpretationInput): Promise<ConsultationInterpretationProposal>;\n}\n\nconst SHORT_FORM_PATTERN''',
    '''export interface ConsultationInterpreter {\n  interpret(input: ConsultationInterpretationInput): Promise<ConsultationInterpretationProposal>;\n}\n\nexport function inferConsultationResourceNeed(message: string): ConsultationResourceNeed {\n  const normalized = message.toLocaleLowerCase("en-US");\n  const asksToPrepare = /\\b(?:prepare|create|make|build|draft|write|compose)\\b/u.test(normalized);\n  if (!asksToPrepare) return "NONE";\n  if (/\\b(?:checklist|check list)\\b/u.test(normalized)) return "CHECKLIST";\n  if (/\\b(?:message|email|note|reply|response)\\b/u.test(normalized)) return "PREPARED_MESSAGE";\n  return "NONE";\n}\n\nconst SHORT_FORM_PATTERN''',
)
replace_once(
    "src/intent/consultation-interpreter.ts",
    '''    const normalized = message.toLocaleLowerCase("en-US");\n    const missingReferent''',
    '''    const missingReferent''',
)
replace_once(
    "src/intent/consultation-interpreter.ts",
    '''    const asksToPrepare = /\\b(?:prepare|create|make|build|draft|write|compose)\\b/u.test(normalized);\n    const resourceNeed: ConsultationResourceNeed = asksToPrepare && /\\b(?:checklist|check list)\\b/u.test(normalized)\n      ? "CHECKLIST"\n      : asksToPrepare && /\\b(?:message|email|note|reply|response)\\b/u.test(normalized)\n        ? "PREPARED_MESSAGE"\n        : "NONE";''',
    '''    const resourceNeed = inferConsultationResourceNeed(message);''',
)

replace_once(
    "src/outcome.ts",
    '''export interface PreparedResource {\n  kind: "CHECKLIST" | "PREPARED_MESSAGE";\n  title: string;\n  body: string;\n  editable: true;\n  executionAuthorized: false;\n}''',
    '''export interface PreparedResourceBasis {\n  knowledgeId: string;\n  claimIds: string[];\n}\n\nexport interface PreparedResource {\n  kind: "CHECKLIST" | "PREPARED_MESSAGE";\n  title: string;\n  body: string;\n  editable: true;\n  executionAuthorized: false;\n  basis?: PreparedResourceBasis[];\n  preservedUncertainties?: string[];\n}''',
)

replace_once(
    "src/solandra/cognition-composition.ts",
    '''import { ModelSolandraAdvisoryRuntime, type SolandraAdvisoryRuntime } from "./advisory.js";\nimport { ModelSolandraCognitiveRuntime, type SolandraCognitiveRuntime } from "./cognition.js";''',
    '''import { ModelSolandraAdvisoryRuntime, type SolandraAdvisoryRuntime } from "./advisory.js";\nimport { ModelSolandraActionPreparer, type SolandraActionPreparer } from "./action-preparer.js";\nimport { ModelSolandraCognitiveRuntime, type SolandraCognitiveRuntime } from "./cognition.js";''',
)
replace_once(
    "src/solandra/cognition-composition.ts",
    '''  advisory: SolandraAdvisoryRuntime;\n  knowledgePresenter: SolandraKnowledgePresenter;''',
    '''  advisory: SolandraAdvisoryRuntime;\n  actionPreparer: SolandraActionPreparer;\n  knowledgePresenter: SolandraKnowledgePresenter;''',
)
replace_once(
    "src/solandra/cognition-composition.ts",
    '''    cognition: new ModelSolandraCognitiveRuntime(runtime, model),\n    advisory: new ModelSolandraAdvisoryRuntime(runtime, model),\n    knowledgePresenter: new ModelSolandraKnowledgePresenter(runtime, model),''',
    '''    cognition: new ModelSolandraCognitiveRuntime(runtime, model),\n    advisory: new ModelSolandraAdvisoryRuntime(runtime, model),\n    actionPreparer: new ModelSolandraActionPreparer(runtime, model),\n    knowledgePresenter: new ModelSolandraKnowledgePresenter(runtime, model),''',
)

replace_once(
    "src/index.ts",
    '''        solandraCognition: solandra.cognition,\n        solandraAdvisory: solandra.advisory,\n        solandraKnowledgePresenter: solandra.knowledgePresenter,''',
    '''        solandraCognition: solandra.cognition,\n        solandraAdvisory: solandra.advisory,\n        solandraActionPreparer: solandra.actionPreparer,\n        solandraKnowledgePresenter: solandra.knowledgePresenter,''',
)

replace_once(
    "src/consultation-intake.ts",
    '''import type { ConversationStore } from "./conversation/conversation-store.js";''',
    '''import {\n  buildPreparedResourceRecord,\n  preparedResourceFromRecord,\n  type PreparedResourceStore,\n} from "./action-preparation/prepared-resource-store.js";\nimport type { ConversationStore } from "./conversation/conversation-store.js";''',
)
replace_once(
    "src/consultation-intake.ts",
    '''  ConservativeConsultationInterpreter,\n  type ConsultationInterpretationProposal,''',
    '''  ConservativeConsultationInterpreter,\n  inferConsultationResourceNeed,\n  type ConsultationInterpretationProposal,''',
)
replace_once(
    "src/consultation-intake.ts",
    '''import type { SolandraAdvisoryRuntime } from "./solandra/advisory.js";''',
    '''import type { SolandraAdvisoryRuntime } from "./solandra/advisory.js";\nimport type { SolandraActionPreparer } from "./solandra/action-preparer.js";''',
)
replace_once(
    "src/consultation-intake.ts",
    '''  recommendationStore?: RecommendationStore;\n  solandraCognition?: SolandraCognitiveRuntime;\n  solandraAdvisory?: SolandraAdvisoryRuntime;''',
    '''  recommendationStore?: RecommendationStore;\n  preparedResourceStore?: PreparedResourceStore;\n  solandraCognition?: SolandraCognitiveRuntime;\n  solandraAdvisory?: SolandraAdvisoryRuntime;\n  solandraActionPreparer?: SolandraActionPreparer;''',
)
replace_once(
    "src/consultation-intake.ts",
    '''          interpretation = cognitiveInterpretation(\n            sourceMessage,\n            currentVersion,\n            cognition,\n            parsed.data.prepare,\n          );''',
    '''          const inferredResourceNeed = cognition.proposal.requestedHelp === "RESOURCE"\n            ? inferConsultationResourceNeed(sourceMessage.content)\n            : "NONE";\n          if (\n            cognition.proposal.requestedHelp === "RESOURCE"\n            && parsed.data.prepare === undefined\n            && inferredResourceNeed !== "PREPARED_MESSAGE"\n          ) {\n            return reply.status(422).send({\n              error: "RESOURCE_SCOPE_UNSUPPORTED",\n              message: "I can currently prepare an editable message, email, note, reply, or response. This requested resource type is not supported yet.",\n              interpretation: publicCognition(cognition),\n            });\n          }\n          interpretation = cognitiveInterpretation(\n            sourceMessage,\n            currentVersion,\n            cognition,\n            parsed.data.prepare ?? (inferredResourceNeed === "PREPARED_MESSAGE" ? inferredResourceNeed : undefined),\n          );''',
)
replace_once(
    "src/consultation-intake.ts",
    '''    const outcome = buildRunOutcome(run, truth);\n    if (outcome.kind !== "KNOWLEDGE" || !options.knowledgeStore) {\n      return reply.send({ runId: run.id, status: run.status, outcome });\n    }''',
    '''    const outcome = buildRunOutcome(run, truth);\n    if (\n      outcome.kind === "ACTION_PREPARATION"\n      && outcome.resource.kind === "PREPARED_MESSAGE"\n      && isConsultationRunRequest(run.request)\n    ) {\n      if (!options.knowledgeStore || !options.preparedResourceStore || !options.solandraActionPreparer) {\n        return reply.status(503).send({\n          error: "SOLANDRA_ACTION_PREPARATION_UNAVAILABLE",\n          message: "Editable message preparation is not available in the current Product composition.",\n        });\n      }\n      const intentScopeId = run.request.intentScopeId;\n      const intentVersionId = run.request.intentVersionId;\n      if (!intentScopeId || !intentVersionId) {\n        return reply.status(409).send({ error: "ACTION_PREPARATION_INTENT_BINDING_UNAVAILABLE" });\n      }\n      const intentVersion = await options.intentStore.getVersion(intentVersionId);\n      if (!intentVersion || intentVersion.intentScopeId !== intentScopeId) {\n        return reply.status(409).send({ error: "ACTION_PREPARATION_INTENT_BINDING_UNAVAILABLE" });\n      }\n      const established = await establishKnowledge(options.knowledgeStore, run, truth, outcome.knowledge);\n      const knowledgeReference = {\n        knowledgeId: established.record.knowledgeId,\n        referenceId: established.reference.referenceId,\n        responseId: established.reference.responseId,\n      };\n      let prepared = await options.preparedResourceStore.getPreparedResourceByRunId(run.id);\n      if (!prepared) {\n        const sourceMessage = await options.userMessageStore.get(run.request.sourceMessageId);\n        if (!sourceMessage || sourceMessage.conversationId !== run.conversationId) {\n          return reply.status(409).send({ error: "ACTION_PREPARATION_USER_SOURCE_UNAVAILABLE" });\n        }\n        const governed = await recentGovernedKnowledge(\n          options.knowledgeStore,\n          options.runStore,\n          run.conversationId,\n          4,\n        );\n        let generated;\n        try {\n          generated = await options.solandraActionPreparer.prepare({\n            conversationId: run.conversationId,\n            runId: run.id,\n            intentVersionId,\n            userMessageId: sourceMessage.messageId,\n            userMessage: sourceMessage.content,\n            authoritativeObjective: authoritativeObjective(intentVersion),\n            knowledge: governed.map(governedKnowledgeContext),\n          });\n        } catch (error) {\n          const message = error instanceof Error ? error.message : "Solandra Action Preparation failed.";\n          return reply.status(422).send({ error: "SOLANDRA_ACTION_PREPARATION_FAILED", message });\n        }\n        if (generated.result.status !== "PREPARED") {\n          return reply.status(422).send({\n            error: "SOLANDRA_ACTION_PREPARATION_FAILED",\n            status: generated.result.status,\n            message: generated.result.reason,\n          });\n        }\n        const candidate = buildPreparedResourceRecord({\n          conversationId: run.conversationId,\n          runId: run.id,\n          intentScopeId,\n          intentVersionId,\n          sourceMessageId: sourceMessage.messageId,\n          kind: "PREPARED_MESSAGE",\n          title: "Prepared message",\n          body: generated.result.body,\n          basis: generated.result.basis,\n          preservedUncertainties: generated.result.preservedUncertainties,\n          createdAt: sourceMessage.createdAt,\n        });\n        try {\n          prepared = await options.preparedResourceStore.putPreparedResource(candidate);\n        } catch (error) {\n          const raced = await options.preparedResourceStore.getPreparedResourceByRunId(run.id);\n          if (!raced) throw error;\n          prepared = raced;\n        }\n      }\n      const preparedOutcome = {\n        ...outcome,\n        resource: preparedResourceFromRecord(prepared),\n      };\n      return reply.send({\n        runId: run.id,\n        status: run.status,\n        outcome: preparedOutcome,\n        knowledgeReference,\n        preparationReference: {\n          resourceId: prepared.resourceId,\n          intentVersionId: prepared.intentVersionId,\n          knowledgeIds: prepared.knowledgeIds,\n          claimIds: prepared.claimIds,\n          editable: prepared.editable,\n          executionAuthorized: prepared.executionAuthorized,\n        },\n      });\n    }\n    if (outcome.kind !== "KNOWLEDGE" || !options.knowledgeStore) {\n      return reply.send({ runId: run.id, status: run.status, outcome });\n    }''',
)

replace_once(
    "src/runtime-app.ts",
    '''import type { FastifyInstance } from "fastify";''',
    '''import type { FastifyInstance } from "fastify";\nimport {\n  MemoryPreparedResourceStore,\n  PostgresPreparedResourceStore,\n  type PreparedResourceStore,\n} from "./action-preparation/prepared-resource-store.js";''',
)
replace_once(
    "src/runtime-app.ts",
    '''import type { SolandraAdvisoryRuntime } from "./solandra/advisory.js";''',
    '''import type { SolandraAdvisoryRuntime } from "./solandra/advisory.js";\nimport type { SolandraActionPreparer } from "./solandra/action-preparer.js";''',
)
replace_once(
    "src/runtime-app.ts",
    '''  recommendationStore?: RecommendationStore;\n  solandraCognition?: SolandraCognitiveRuntime;\n  solandraAdvisory?: SolandraAdvisoryRuntime;''',
    '''  recommendationStore?: RecommendationStore;\n  preparedResourceStore?: PreparedResourceStore;\n  solandraCognition?: SolandraCognitiveRuntime;\n  solandraAdvisory?: SolandraAdvisoryRuntime;\n  solandraActionPreparer?: SolandraActionPreparer;''',
)
replace_once(
    "src/runtime-app.ts",
    '''  await PostgresKnowledgeRecordStore.migrate(databaseUrl);\n  await PostgresRecommendationStore.migrate(databaseUrl);''',
    '''  await PostgresKnowledgeRecordStore.migrate(databaseUrl);\n  await PostgresRecommendationStore.migrate(databaseUrl);\n  await PostgresPreparedResourceStore.migrate(databaseUrl);''',
)
replace_once(
    "src/runtime-app.ts",
    '''  knowledgeStore: KnowledgeRecordStore;\n  recommendationStore: RecommendationStore;\n}> {''',
    '''  knowledgeStore: KnowledgeRecordStore;\n  recommendationStore: RecommendationStore;\n  preparedResourceStore: PreparedResourceStore;\n}> {''',
)
replace_once(
    "src/runtime-app.ts",
    '''                    const recommendationStore = await PostgresRecommendationStore.connect(databaseUrl);\n                    const decisionPlanControl = new DecisionPlanRecordingApiRunControlStore(baseApiControlStore, decisionPlanStore);\n                    const apiControlStore = new ConversationRunIndexRecordingApiRunControlStore(decisionPlanControl, runIndexStore);\n                    return {\n                      runStore,\n                      apiControlStore,\n                      intentStore,\n                      userMessageStore,\n                      userPreferenceStore,\n                      conversationStore,\n                      decisionPlanStore,\n                      runIndexStore,\n                      knowledgeStore,\n                      recommendationStore,\n                    };''',
    '''                    const recommendationStore = await PostgresRecommendationStore.connect(databaseUrl);\n                    try {\n                      const preparedResourceStore = await PostgresPreparedResourceStore.connect(databaseUrl);\n                      const decisionPlanControl = new DecisionPlanRecordingApiRunControlStore(baseApiControlStore, decisionPlanStore);\n                      const apiControlStore = new ConversationRunIndexRecordingApiRunControlStore(decisionPlanControl, runIndexStore);\n                      return {\n                        runStore,\n                        apiControlStore,\n                        intentStore,\n                        userMessageStore,\n                        userPreferenceStore,\n                        conversationStore,\n                        decisionPlanStore,\n                        runIndexStore,\n                        knowledgeStore,\n                        recommendationStore,\n                        preparedResourceStore,\n                      };\n                    } catch (error) {\n                      await recommendationStore.close();\n                      throw error;\n                    }''',
)
replace_once(
    "src/runtime-app.ts",
    '''  let knowledgeStore: KnowledgeRecordStore;\n  let recommendationStore: RecommendationStore;''',
    '''  let knowledgeStore: KnowledgeRecordStore;\n  let recommendationStore: RecommendationStore;\n  let preparedResourceStore: PreparedResourceStore;''',
)
replace_once(
    "src/runtime-app.ts",
    '''      knowledgeStore,\n      recommendationStore,\n    } = await connectPostgresRuntimeStores(config.databaseUrl, config.autoMigrate));''',
    '''      knowledgeStore,\n      recommendationStore,\n      preparedResourceStore,\n    } = await connectPostgresRuntimeStores(config.databaseUrl, config.autoMigrate));''',
)
replace_once(
    "src/runtime-app.ts",
    '''    const memoryKnowledgeStore = options.knowledgeStore ?? new MemoryKnowledgeRecordStore();\n    const memoryRecommendationStore = options.recommendationStore ?? new MemoryRecommendationStore();''',
    '''    const memoryKnowledgeStore = options.knowledgeStore ?? new MemoryKnowledgeRecordStore();\n    const memoryRecommendationStore = options.recommendationStore ?? new MemoryRecommendationStore();\n    const memoryPreparedResourceStore = options.preparedResourceStore ?? new MemoryPreparedResourceStore();''',
)
replace_once(
    "src/runtime-app.ts",
    '''    knowledgeStore = memoryKnowledgeStore;\n    recommendationStore = memoryRecommendationStore;''',
    '''    knowledgeStore = memoryKnowledgeStore;\n    recommendationStore = memoryRecommendationStore;\n    preparedResourceStore = memoryPreparedResourceStore;''',
)
replace_once(
    "src/runtime-app.ts",
    '''    knowledgeStore,\n    recommendationStore,\n    ...(options.consultationInterpreter ? { interpreter: options.consultationInterpreter } : {}),''',
    '''    knowledgeStore,\n    recommendationStore,\n    preparedResourceStore,\n    ...(options.consultationInterpreter ? { interpreter: options.consultationInterpreter } : {}),''',
)
replace_once(
    "src/runtime-app.ts",
    '''    ...(options.solandraAdvisory ? { solandraAdvisory: options.solandraAdvisory } : {}),\n    ...(options.solandraKnowledgePresenter ? { solandraKnowledgePresenter: options.solandraKnowledgePresenter } : {}),''',
    '''    ...(options.solandraAdvisory ? { solandraAdvisory: options.solandraAdvisory } : {}),\n    ...(options.solandraActionPreparer ? { solandraActionPreparer: options.solandraActionPreparer } : {}),\n    ...(options.solandraKnowledgePresenter ? { solandraKnowledgePresenter: options.solandraKnowledgePresenter } : {}),''',
)
replace_once(
    "src/runtime-app.ts",
    '''    knowledgeStore,\n    recommendationStore,\n  });''',
    '''    knowledgeStore,\n    recommendationStore,\n    preparedResourceStore,\n  });''',
)
replace_once(
    "src/runtime-app.ts",
    '''  app.addHook("onClose", async () => {\n    await recommendationStore.close();''',
    '''  app.addHook("onClose", async () => {\n    await preparedResourceStore.close();\n    await recommendationStore.close();''',
)

replace_once(
    "src/conversation/continuity-api.ts",
    '''import type { FastifyInstance } from "fastify";''',
    '''import type { FastifyInstance } from "fastify";\nimport {\n  preparedResourceFromRecord,\n  type PreparedResourceStore,\n} from "../action-preparation/prepared-resource-store.js";''',
)
replace_once(
    "src/conversation/continuity-api.ts",
    '''  recommendationStore?: RecommendationStore;\n}''',
    '''  recommendationStore?: RecommendationStore;\n  preparedResourceStore?: PreparedResourceStore;\n}''',
)
replace_once(
    "src/conversation/continuity-api.ts",
    '''    const outcome = truth ? buildRunOutcome(run, truth) : undefined;\n    return { run, decisionPlan, intentVersion, outcome };''',
    '''    let outcome = truth ? buildRunOutcome(run, truth) : undefined;\n    if (\n      outcome?.kind === "ACTION_PREPARATION"\n      && outcome.resource.kind === "PREPARED_MESSAGE"\n      && options.preparedResourceStore\n    ) {\n      const prepared = await options.preparedResourceStore.getPreparedResourceByRunId(run.id);\n      if (prepared) outcome = { ...outcome, resource: preparedResourceFromRecord(prepared) };\n    }\n    return { run, decisionPlan, intentVersion, outcome };''',
)

write("test/m3-solandra-action-preparation.test.ts", r'''import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import type { ModelRuntime } from "../src/model/runtime.js";
import type { ModelInvocationProvenance } from "../src/model/types.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import {
  ModelSolandraActionPreparer,
  type SolandraActionPreparationInput,
  type SolandraActionPreparationRuntimeResult,
  type SolandraActionPreparer,
} from "../src/solandra/action-preparer.js";
import type {
  SolandraCognitionInput,
  SolandraCognitionResult,
  SolandraCognitiveRuntime,
  SolandraSemanticProposal,
} from "../src/solandra/cognition.js";
import { requiredProofObligations } from "../src/truth/contracts.js";
import { OfflineFixtureTruthPipeline } from "../src/truth/execution-pipeline.js";

const FINDING = "The admitted inspection record reports visible water staining on the ceiling near the damaged area.";
const PROVENANCE: ModelInvocationProvenance = Object.freeze({
  executionClass: "LOCAL_OFFLINE",
  routeMode: "PINNED",
  requestedProvider: "m3-deterministic",
  requestedModel: "m3-deterministic-model",
  actualProvider: "m3-deterministic",
  actualModel: "m3-deterministic-model",
  brokerIdentity: null,
  brokerVersion: null,
  upstreamRequestId: "m3-deterministic-request",
  routeProvenance: "COMPLETE",
});

const truthPipeline = new OfflineFixtureTruthPipeline({
  evidence: [{
    id: "m3-evidence",
    value: FINDING,
    sourceId: "m3-source",
    sourceLabel: "M3 governed inspection record",
    admitted: true,
  }],
  truthClaims: [{
    id: "m3-claim",
    text: FINDING,
    claimType: "FACTUAL",
    evidenceIds: ["m3-evidence"],
    scope: "consultation",
    checks: Object.fromEntries(requiredProofObligations("FACTUAL").map((kind) => [kind, "PASSED"])),
    materiallyMisleading: false,
  }],
  truthEvidence: [{
    evidenceId: "m3-evidence",
    claimId: "m3-claim",
    provenanceComponentKey: "m3-source",
    provenanceConfidence: "HIGH",
    relation: "SUPPORTS",
    sourceAccepted: true,
    authoritativePrimary: true,
    verification: "VERIFIED",
  }],
});

function proposal(overrides: Partial<SolandraSemanticProposal> = {}): SolandraSemanticProposal {
  return {
    objectiveRelation: "CONTINUE",
    proposedObjective: null,
    requestedHelp: "KNOWLEDGE",
    relevantContext: [],
    entities: [],
    referents: [],
    constraints: [],
    preferences: [],
    knowledgeNeeds: [],
    materialAmbiguity: null,
    referencedKnowledgeId: null,
    referencedRecommendationId: null,
    ...overrides,
  };
}

class M3Cognition implements SolandraCognitiveRuntime {
  readonly inputs: SolandraCognitionInput[] = [];

  async interpret(input: SolandraCognitionInput): Promise<SolandraCognitionResult> {
    this.inputs.push(structuredClone(input));
    const lower = input.message.toLocaleLowerCase("en-US");
    if (/draft|prepare|write|compose/iu.test(lower)) {
      return {
        proposal: proposal({
          objectiveRelation: input.currentObjective ? "CONTINUE" : "NEW_OBJECTIVE",
          proposedObjective: input.currentObjective ? null : "Model proposal must remain non-authoritative.",
          requestedHelp: "RESOURCE",
        }),
        invocationProvenance: PROVENANCE,
      };
    }
    return {
      proposal: proposal({
        objectiveRelation: input.currentObjective ? "CONTINUE" : "NEW_OBJECTIVE",
        proposedObjective: input.currentObjective ? null : "Model proposal must remain non-authoritative.",
        requestedHelp: "KNOWLEDGE",
        knowledgeNeeds: ["governed inspection evidence relevant to the USER's objective"],
      }),
      invocationProvenance: PROVENANCE,
    };
  }
}

class M3Preparer implements SolandraActionPreparer {
  readonly inputs: SolandraActionPreparationInput[] = [];

  async prepare(input: SolandraActionPreparationInput): Promise<SolandraActionPreparationRuntimeResult> {
    this.inputs.push(structuredClone(input));
    const knowledge = input.knowledge[0];
    assert.ok(knowledge);
    const claim = knowledge.findings[0];
    assert.ok(claim);
    const contractor = /contractor/iu.test(input.userMessage);
    return {
      result: {
        status: "PREPARED",
        body: contractor
          ? "Hello, could you please provide a written estimate for the repair work we discussed? Thank you."
          : "Hello, could you please inspect the water-damaged area and let me know what you find? Thank you.",
        basis: [{ knowledgeId: knowledge.knowledgeId, claimIds: [claim.claimId] }],
        preservedUncertainties: [...knowledge.uncertainties],
      },
      generationProvenance: PROVENANCE,
      groundingProvenance: PROVENANCE,
    };
  }
}

const config = resolveRuntimeConfig({
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-offline",
} as NodeJS.ProcessEnv);

async function createConversation(app: FastifyInstance): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/conversations" });
  assert.equal(response.statusCode, 201, response.body);
  return response.json<{ conversation: { id: string } }>().conversation.id;
}

async function waitForCompletion(app: FastifyInstance, runId: string): Promise<void> {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const response = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}` });
    assert.equal(response.statusCode, 200, response.body);
    const status = response.json<{ status: string }>().status;
    if (status === "COMPLETED") return;
    if (status === "FAILED" || status === "CANCELLED") throw new Error(`Run reached ${status}.`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("M3 test Run did not complete.");
}

async function establishKnowledge(app: FastifyInstance, conversationId: string): Promise<{ knowledgeId: string; intentVersionId: string }> {
  const message = "Help me establish what the inspection record says about the damaged area.";
  const turn = await app.inject({
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/turns`,
    payload: { turnId: randomUUID(), message },
  });
  assert.equal(turn.statusCode, 202, turn.body);
  const accepted = turn.json<{ runId: string; intentVersionId: string; interpretation: { requestedHelp: string } }>();
  assert.equal(accepted.interpretation.requestedHelp, "KNOWLEDGE");
  await waitForCompletion(app, accepted.runId);
  const outcome = await app.inject({ method: "GET", url: `/api/v1/runs/${accepted.runId}/outcome` });
  assert.equal(outcome.statusCode, 200, outcome.body);
  const established = outcome.json<{ outcome: { kind: string }; knowledgeReference: { knowledgeId: string } }>();
  assert.equal(established.outcome.kind, "KNOWLEDGE");
  return { knowledgeId: established.knowledgeReference.knowledgeId, intentVersionId: accepted.intentVersionId };
}

async function prepareMessage(
  app: FastifyInstance,
  conversationId: string,
  message: string,
): Promise<{ runId: string; body: string; resourceId: string; intentVersionId: string; knowledgeIds: string[] }> {
  const turn = await app.inject({
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/turns`,
    payload: { turnId: randomUUID(), message },
  });
  assert.equal(turn.statusCode, 202, turn.body);
  const accepted = turn.json<{ runId: string; intentVersionId: string; interpretation: { requestedHelp: string } }>();
  assert.equal(accepted.interpretation.requestedHelp, "RESOURCE");
  await waitForCompletion(app, accepted.runId);
  const outcome = await app.inject({ method: "GET", url: `/api/v1/runs/${accepted.runId}/outcome` });
  assert.equal(outcome.statusCode, 200, outcome.body);
  const body = outcome.json<{
    outcome: {
      kind: string;
      resource: {
        kind: string;
        body: string;
        editable: boolean;
        executionAuthorized: boolean;
        basis: Array<{ knowledgeId: string; claimIds: string[] }>;
      };
    };
    preparationReference: {
      resourceId: string;
      intentVersionId: string;
      knowledgeIds: string[];
      claimIds: string[];
      editable: boolean;
      executionAuthorized: boolean;
    };
  }>();
  assert.equal(body.outcome.kind, "ACTION_PREPARATION");
  assert.equal(body.outcome.resource.kind, "PREPARED_MESSAGE");
  assert.equal(body.outcome.resource.editable, true);
  assert.equal(body.outcome.resource.executionAuthorized, false);
  assert.equal(body.preparationReference.executionAuthorized, false);
  assert.equal(body.preparationReference.editable, true);
  assert.equal(body.preparationReference.intentVersionId, accepted.intentVersionId);
  assert.ok(body.outcome.resource.basis.length > 0);
  assert.ok(body.preparationReference.claimIds.length > 0);
  return {
    runId: accepted.runId,
    body: body.outcome.resource.body,
    resourceId: body.preparationReference.resourceId,
    intentVersionId: accepted.intentVersionId,
    knowledgeIds: body.preparationReference.knowledgeIds,
  };
}

test("ordinary Solandra RESOURCE conversation produces a task-specific governed editable message without a prepare API field", async () => {
  const cognition = new M3Cognition();
  const preparer = new M3Preparer();
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    truthPipeline,
    solandraCognition: cognition,
    solandraActionPreparer: preparer,
  });
  try {
    const conversationId = await createConversation(app);
    const established = await establishKnowledge(app, conversationId);
    const request = "Draft a short message to my landlord asking them to inspect the water damage, using what we established.";
    const prepared = await prepareMessage(app, conversationId, request);
    assert.match(prepared.body, /inspect the water-damaged area/iu);
    assert.doesNotMatch(prepared.body, /^Objective:/u);
    assert.ok(prepared.knowledgeIds.includes(established.knowledgeId));
    assert.equal(preparer.inputs.length, 1);
    assert.equal(preparer.inputs[0]?.userMessage, request);
    assert.equal(preparer.inputs[0]?.intentVersionId, prepared.intentVersionId);
    assert.ok(preparer.inputs[0]?.knowledge.some((item) => item.knowledgeId === established.knowledgeId));

    const replay = await app.inject({ method: "GET", url: `/api/v1/runs/${prepared.runId}/outcome` });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.json<{ outcome: { resource: { body: string } } }>().outcome.resource.body, prepared.body);
    assert.equal(preparer.inputs.length, 1, "historical preparation replay must reuse the durable PreparedResource");

    const presentation = await app.inject({
      method: "GET",
      url: `/api/v1/conversations/${conversationId}/presentation`,
    });
    assert.equal(presentation.statusCode, 200, presentation.body);
    const snapshot = presentation.json<{
      presentation: {
        presentationRevision: string;
        resources: Array<{ id: string; editable?: boolean; executionAuthorized?: boolean }>;
      };
    }>().presentation;
    assert.equal(snapshot.resources.length, 1);
    assert.equal(snapshot.resources[0]?.editable, true);
    assert.equal(snapshot.resources[0]?.executionAuthorized, false);
    const resourceId = snapshot.resources[0]?.id;
    assert.ok(resourceId);
    const hydrated = await app.inject({
      method: "GET",
      url: `/api/v1/conversations/${conversationId}/presentation/resources/${encodeURIComponent(resourceId)}?presentationRevision=${encodeURIComponent(snapshot.presentationRevision)}`,
    });
    assert.equal(hydrated.statusCode, 200, hydrated.body);
    const resource = hydrated.json<{
      resource: { descriptor: { editable?: boolean; executionAuthorized?: boolean }; payload: { text: string } };
    }>().resource;
    assert.equal(resource.descriptor.editable, true);
    assert.equal(resource.descriptor.executionAuthorized, false);
    assert.equal(resource.payload.text, prepared.body);
  } finally {
    await app.close();
  }
});

test("materially different ordinary message requests reach preparation with different task purposes", async () => {
  const cognition = new M3Cognition();
  const preparer = new M3Preparer();
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    truthPipeline,
    solandraCognition: cognition,
    solandraActionPreparer: preparer,
  });
  try {
    const leftConversation = await createConversation(app);
    await establishKnowledge(app, leftConversation);
    const left = await prepareMessage(
      app,
      leftConversation,
      "Draft a short message to my landlord asking them to inspect the water damage.",
    );

    const rightConversation = await createConversation(app);
    await establishKnowledge(app, rightConversation);
    const right = await prepareMessage(
      app,
      rightConversation,
      "Write a brief message to my contractor asking for a written repair estimate.",
    );

    assert.notEqual(left.body, right.body);
    assert.match(left.body, /inspect/iu);
    assert.match(right.body, /written estimate/iu);
    assert.equal(preparer.inputs.length, 2);
    assert.notEqual(preparer.inputs[0]?.userMessage, preparer.inputs[1]?.userMessage);
  } finally {
    await app.close();
  }
});

test("unsupported ordinary RESOURCE scope fails honestly instead of returning generic preparation", async () => {
  const cognition = new M3Cognition();
  const preparer = new M3Preparer();
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    truthPipeline,
    solandraCognition: cognition,
    solandraActionPreparer: preparer,
  });
  try {
    const conversationId = await createConversation(app);
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: randomUUID(), message: "Prepare a spreadsheet I can use to track repair costs." },
    });
    assert.equal(response.statusCode, 422, response.body);
    const body = response.json<{ error: string; message: string }>();
    assert.equal(body.error, "RESOURCE_SCOPE_UNSUPPORTED");
    assert.match(body.message, /editable message/iu);
    assert.equal(preparer.inputs.length, 0);

    const continuity = await app.inject({ method: "GET", url: `/api/v1/conversations/${conversationId}/continuity` });
    assert.equal(continuity.statusCode, 200, continuity.body);
    assert.equal(continuity.json<{ runs: unknown[] }>().runs.length, 0);
  } finally {
    await app.close();
  }
});

function runtimeResult(text: string): any {
  return {
    response: {
      id: randomUUID(),
      model: "m3-deterministic-model",
      output: [{ type: "text", text }],
      usage: { inputTokens: 1, outputTokens: 1 },
      stopReason: "stop",
      providerMetadata: {},
    },
    audit: { invocationProvenance: PROVENANCE },
  };
}

class ScriptedRuntime {
  readonly calls: unknown[] = [];
  constructor(private readonly outputs: string[]) {}
  async call(request: unknown): Promise<any> {
    this.calls.push(structuredClone(request));
    const next = this.outputs.shift();
    assert.ok(next, "scripted runtime output exhausted");
    return runtimeResult(next);
  }
}

const preparationInput: SolandraActionPreparationInput = {
  conversationId: "conversation-m3",
  runId: "11111111-1111-4111-8111-111111111111",
  intentVersionId: "intent-version-m3",
  userMessageId: "message-m3",
  userMessage: "Draft a message asking my landlord to inspect the water damage.",
  authoritativeObjective: "Address the documented water damage responsibly.",
  knowledge: [{
    knowledgeId: "knowledge-m3",
    objective: "Address the documented water damage responsibly.",
    findings: [{ claimId: "claim-m3", text: FINDING, status: "SUPPORTED" }],
    sourceCount: 1,
    uncertainties: ["The inspection record does not establish the cause of the water damage."],
  }],
};

test("model Action Preparation rejects invented governed claim references before grounding", async () => {
  const runtime = new ScriptedRuntime([
    JSON.stringify({
      status: "PREPARED",
      body: "Hello, please inspect the water damage.",
      basis: [{ knowledgeId: "knowledge-m3", claimIds: ["invented-claim"] }],
    }),
  ]);
  const preparer = new ModelSolandraActionPreparer(runtime as unknown as Pick<ModelRuntime, "call">, "m3-deterministic-model");
  const result = await preparer.prepare(preparationInput);
  assert.equal(result.result.status, "FIDELITY_REJECTED");
  assert.equal(runtime.calls.length, 1, "invalid provenance must fail before grounding");
});

test("model Action Preparation fails closed on unsupported factual generation", async () => {
  const runtime = new ScriptedRuntime([
    JSON.stringify({
      status: "PREPARED",
      body: "Hello, you already agreed to pay for all repairs, so please inspect the water damage.",
      basis: [{ knowledgeId: "knowledge-m3", claimIds: ["claim-m3"] }],
    }),
    JSON.stringify({
      status: "UNSUPPORTED",
      unsupportedExternalPremises: ["The recipient agreed to pay for all repairs."],
      materialUncertaintyPreserved: true,
      authorityBoundaryPreserved: true,
    }),
  ]);
  const preparer = new ModelSolandraActionPreparer(runtime as unknown as Pick<ModelRuntime, "call">, "m3-deterministic-model");
  const result = await preparer.prepare(preparationInput);
  assert.equal(result.result.status, "FIDELITY_REJECTED");
  assert.equal(runtime.calls.length, 2);
});

test("model Action Preparation fails closed when material uncertainty would disappear", async () => {
  const runtime = new ScriptedRuntime([
    JSON.stringify({
      status: "PREPARED",
      body: "Hello, the water damage was caused by the roof, so please inspect it.",
      basis: [{ knowledgeId: "knowledge-m3", claimIds: ["claim-m3"] }],
    }),
    JSON.stringify({
      status: "GROUNDED",
      unsupportedExternalPremises: [],
      materialUncertaintyPreserved: false,
      authorityBoundaryPreserved: true,
    }),
  ]);
  const preparer = new ModelSolandraActionPreparer(runtime as unknown as Pick<ModelRuntime, "call">, "m3-deterministic-model");
  const result = await preparer.prepare(preparationInput);
  assert.equal(result.result.status, "FIDELITY_REJECTED");
});
''')

print("M3 implementation patch applied")
