from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if text.count(old) != 1:
        raise SystemExit(f"expected exactly one match in {path}: {old[:100]!r}, found {text.count(old)}")
    p.write_text(text.replace(old, new, 1))


def write(path: str, content: str) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content)


write("migrations/037_m4_general_decision_journey.sql", '''ALTER TABLE recommendations
  ALTER COLUMN run_id DROP NOT NULL;

ALTER TABLE recommendations
  ADD COLUMN user_material_basis jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE recommendations
  ADD CONSTRAINT recommendations_user_material_basis_array
  CHECK (jsonb_typeof(user_material_basis) = 'array');

CREATE TABLE accepted_choices (
  accepted_choice_id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  intent_scope_id text NOT NULL,
  intent_version_id text NOT NULL,
  recommendation_id text NOT NULL REFERENCES recommendations(recommendation_id) ON DELETE CASCADE,
  option_id text NOT NULL,
  option_text text NOT NULL CHECK (length(btrim(option_text)) > 0),
  source_message_id text NOT NULL REFERENCES intent_user_messages(message_id) ON DELETE CASCADE,
  source_message_digest text NOT NULL,
  authorization_granted boolean NOT NULL DEFAULT false CHECK (authorization_granted = false),
  execution_authorized boolean NOT NULL DEFAULT false CHECK (execution_authorized = false),
  created_at timestamptz NOT NULL,
  UNIQUE(source_message_id)
);

CREATE INDEX accepted_choices_conversation_created_idx
  ON accepted_choices(conversation_id, created_at, accepted_choice_id);
''')

write("src/recommendation/recommendation-options.ts", '''import { createHash } from "node:crypto";
import type { RecommendationRecord } from "./recommendation-store.js";

export interface RecommendationOption {
  optionId: string;
  position: number;
  text: string;
  recommended: boolean;
}

function stableOptionId(recommendationId: string, position: number, text: string): string {
  const digest = createHash("sha256")
    .update([recommendationId, String(position), text].join("\\u001f"))
    .digest("hex")
    .slice(0, 40);
  return `recommendation_option_${digest}`;
}

export function recommendationOptions(record: RecommendationRecord): RecommendationOption[] {
  const texts = [record.recommendation, ...record.alternatives];
  return texts.map((text, index) => Object.freeze({
    optionId: stableOptionId(record.recommendationId, index + 1, text),
    position: index + 1,
    text,
    recommended: index === 0,
  }));
}

export function recommendationOption(
  record: RecommendationRecord,
  optionId: string,
): RecommendationOption | undefined {
  return recommendationOptions(record).find((option) => option.optionId === optionId);
}
''')

write("src/intent/accepted-choice-store.ts", '''import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";

const migration = "037_m4_general_decision_journey.sql" as const;

export interface AcceptedChoiceRecord {
  acceptedChoiceId: string;
  conversationId: string;
  intentScopeId: string;
  intentVersionId: string;
  recommendationId: string;
  optionId: string;
  optionText: string;
  sourceMessageId: string;
  sourceMessageDigest: string;
  authorizationGranted: false;
  executionAuthorized: false;
  createdAt: string;
}

export interface AcceptedChoiceStore {
  readonly kind: "memory" | "postgres";
  putAcceptedChoice(record: AcceptedChoiceRecord): Promise<AcceptedChoiceRecord>;
  getAcceptedChoice(acceptedChoiceId: string): Promise<AcceptedChoiceRecord | undefined>;
  listAcceptedChoicesByConversation(conversationId: string): Promise<AcceptedChoiceRecord[]>;
  close(): Promise<void>;
}

function bounded(value: string, label: string, max = 8_000): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new Error(`${label} must contain between 1 and ${max} non-whitespace characters.`);
  }
  return normalized;
}

function iso(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error("AcceptedChoice createdAt must be an ISO-compatible date.");
  return date.toISOString();
}

function clone<T>(value: T): T { return structuredClone(value); }
function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }

export function buildAcceptedChoiceRecord(input: Omit<AcceptedChoiceRecord, "acceptedChoiceId" | "authorizationGranted" | "executionAuthorized">): AcceptedChoiceRecord {
  const conversationId = bounded(input.conversationId, "conversationId", 128);
  const intentScopeId = bounded(input.intentScopeId, "intentScopeId", 200);
  const intentVersionId = bounded(input.intentVersionId, "intentVersionId", 200);
  const recommendationId = bounded(input.recommendationId, "recommendationId", 128);
  const optionId = bounded(input.optionId, "optionId", 128);
  const optionText = bounded(input.optionText, "optionText", 2_000);
  const sourceMessageId = bounded(input.sourceMessageId, "sourceMessageId", 200);
  const sourceMessageDigest = bounded(input.sourceMessageDigest, "sourceMessageDigest", 200);
  const acceptedChoiceId = `accepted_choice_${createHash("sha256")
    .update([conversationId, intentVersionId, recommendationId, optionId, sourceMessageId].join("\\u001f"))
    .digest("hex").slice(0, 40)}`;
  return Object.freeze({
    acceptedChoiceId,
    conversationId,
    intentScopeId,
    intentVersionId,
    recommendationId,
    optionId,
    optionText,
    sourceMessageId,
    sourceMessageDigest,
    authorizationGranted: false,
    executionAuthorized: false,
    createdAt: iso(input.createdAt),
  });
}

export class MemoryAcceptedChoiceStore implements AcceptedChoiceStore {
  readonly kind = "memory" as const;
  private readonly records = new Map<string, AcceptedChoiceRecord>();
  private readonly bySourceMessage = new Map<string, string>();

  async putAcceptedChoice(record: AcceptedChoiceRecord): Promise<AcceptedChoiceRecord> {
    const existing = this.records.get(record.acceptedChoiceId);
    if (existing) {
      if (!same(existing, record)) throw new Error("AcceptedChoice identity cannot be rebound.");
      return clone(existing);
    }
    const priorId = this.bySourceMessage.get(record.sourceMessageId);
    if (priorId && priorId !== record.acceptedChoiceId) {
      throw new Error("One USER source message cannot establish conflicting AcceptedChoice identities.");
    }
    this.records.set(record.acceptedChoiceId, clone(record));
    this.bySourceMessage.set(record.sourceMessageId, record.acceptedChoiceId);
    return clone(record);
  }

  async getAcceptedChoice(acceptedChoiceId: string): Promise<AcceptedChoiceRecord | undefined> {
    const record = this.records.get(acceptedChoiceId);
    return record ? clone(record) : undefined;
  }

  async listAcceptedChoicesByConversation(conversationId: string): Promise<AcceptedChoiceRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.conversationId === conversationId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.acceptedChoiceId.localeCompare(b.acceptedChoiceId))
      .map(clone);
  }

  async close(): Promise<void> {
    this.records.clear();
    this.bySourceMessage.clear();
  }
}

type ChoiceRow = {
  accepted_choice_id: string;
  conversation_id: string;
  intent_scope_id: string;
  intent_version_id: string;
  recommendation_id: string;
  option_id: string;
  option_text: string;
  source_message_id: string;
  source_message_digest: string;
  authorization_granted: boolean;
  execution_authorized: boolean;
  created_at: Date | string;
};

function mapRow(row: ChoiceRow): AcceptedChoiceRecord {
  if (row.authorization_granted !== false || row.execution_authorized !== false) {
    throw new Error("Persisted AcceptedChoice cannot contain action authorization.");
  }
  return {
    acceptedChoiceId: row.accepted_choice_id,
    conversationId: row.conversation_id,
    intentScopeId: row.intent_scope_id,
    intentVersionId: row.intent_version_id,
    recommendationId: row.recommendation_id,
    optionId: row.option_id,
    optionText: row.option_text,
    sourceMessageId: row.source_message_id,
    sourceMessageDigest: row.source_message_digest,
    authorizationGranted: false,
    executionAuthorized: false,
    createdAt: iso(row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at),
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
  if (result.rows[0]?.count !== "1") throw new Error(`AcceptedChoice schema is not ready; required migration ${migration} is missing.`);
}

const columns = "accepted_choice_id,conversation_id,intent_scope_id,intent_version_id,recommendation_id,option_id,option_text,source_message_id,source_message_digest,authorization_granted,execution_authorized,created_at";

export class PostgresAcceptedChoiceStore implements AcceptedChoiceStore {
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

  static async connect(databaseUrl: string): Promise<PostgresAcceptedChoiceStore> {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query("SELECT 1");
      await assertReady(pool);
      return new PostgresAcceptedChoiceStore(pool);
    } catch (error) {
      await pool.end();
      throw error;
    }
  }

  async putAcceptedChoice(record: AcceptedChoiceRecord): Promise<AcceptedChoiceRecord> {
    const result = await this.pool.query<ChoiceRow>(
      `INSERT INTO accepted_choices(${columns}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT(accepted_choice_id) DO NOTHING RETURNING ${columns}`,
      [record.acceptedChoiceId, record.conversationId, record.intentScopeId, record.intentVersionId,
       record.recommendationId, record.optionId, record.optionText, record.sourceMessageId,
       record.sourceMessageDigest, false, false, record.createdAt],
    );
    if ((result.rowCount ?? 0) > 0) return mapRow(result.rows[0]!);
    const existing = await this.getAcceptedChoice(record.acceptedChoiceId);
    if (!existing || !same(existing, record)) throw new Error("AcceptedChoice identity cannot be rebound.");
    return existing;
  }

  async getAcceptedChoice(acceptedChoiceId: string): Promise<AcceptedChoiceRecord | undefined> {
    const result = await this.pool.query<ChoiceRow>(`SELECT ${columns} FROM accepted_choices WHERE accepted_choice_id=$1`, [acceptedChoiceId]);
    return result.rows[0] ? mapRow(result.rows[0]) : undefined;
  }

  async listAcceptedChoicesByConversation(conversationId: string): Promise<AcceptedChoiceRecord[]> {
    const result = await this.pool.query<ChoiceRow>(
      `SELECT ${columns} FROM accepted_choices WHERE conversation_id=$1 ORDER BY created_at,accepted_choice_id`,
      [conversationId],
    );
    return result.rows.map(mapRow);
  }

  async close(): Promise<void> { await this.pool.end(); }
}
''')

# Recommendation store: allow durable user-material Recommendations without a synthetic Run.
replace_once("src/recommendation/recommendation-store.ts", "  runId: string;\n", "  runId: string | null;\n")
replace_once("src/recommendation/recommendation-store.ts", "  basis: RecommendationBasis[];\n", "  basis: RecommendationBasis[];\n  userMaterialBasis: string[];\n")
replace_once(
    "src/recommendation/recommendation-store.ts",
    '  input: Omit<RecommendationRecord, "recommendationId" | "selectionAuthorized" | "knowledgeIds" | "claimIds">,\n',
    '  input: Omit<RecommendationRecord, "recommendationId" | "selectionAuthorized" | "knowledgeIds" | "claimIds" | "userMaterialBasis"> & { userMaterialBasis?: string[] },\n',
)
replace_once(
    "src/recommendation/recommendation-store.ts",
    '  const runId = bounded(input.runId, "runId", 200);\n',
    '  const runId = input.runId === null ? null : bounded(input.runId, "runId", 200);\n',
)
replace_once(
    "src/recommendation/recommendation-store.ts",
    '  if (basis.length === 0) throw new Error("Recommendation requires at least one governed Knowledge/claim basis binding.");\n',
    '  const userMaterialBasis = unique(input.userMaterialBasis ?? []).map((item) => bounded(item, "user material basis", 200));\n  if (basis.length === 0 && userMaterialBasis.length === 0) {\n    throw new Error("Recommendation requires governed Knowledge basis or exact USER-material basis identity.");\n  }\n',
)
replace_once(
    "src/recommendation/recommendation-store.ts",
    '    recommendationId: stableId("recommendation", runId, intentVersionId, ...exactBasisIdentity),\n',
    '    recommendationId: stableId("recommendation", runId ?? sourceMessageId, intentVersionId, ...exactBasisIdentity, ...userMaterialBasis),\n',
)
replace_once(
    "src/recommendation/recommendation-store.ts",
    '    basis: normalizedBasis,\n    knowledgeIds,\n',
    '    basis: normalizedBasis,\n    userMaterialBasis,\n    knowledgeIds,\n',
)
replace_once(
    "src/recommendation/recommendation-store.ts",
    '    const runRecommendation = this.byRun.get(record.runId);\n    if (runRecommendation && runRecommendation !== record.recommendationId) {\n      throw new Error("A completed advisory Run cannot establish multiple Recommendation identities.");\n    }\n    this.records.set(record.recommendationId, clone(record));\n    this.byRun.set(record.runId, record.recommendationId);\n',
    '    const runRecommendation = record.runId === null ? undefined : this.byRun.get(record.runId);\n    if (runRecommendation && runRecommendation !== record.recommendationId) {\n      throw new Error("A completed advisory Run cannot establish multiple Recommendation identities.");\n    }\n    this.records.set(record.recommendationId, clone(record));\n    if (record.runId !== null) this.byRun.set(record.runId, record.recommendationId);\n',
)
replace_once("src/recommendation/recommendation-store.ts", "  run_id: string;\n", "  run_id: string | null;\n")
replace_once("src/recommendation/recommendation-store.ts", "  basis: unknown;\n", "  basis: unknown;\n  user_material_basis: unknown;\n")
replace_once(
    "src/recommendation/recommendation-store.ts",
    '    basis: recommendationBasis(row.basis),\n    knowledgeIds: stringArray(row.knowledge_ids, "knowledge_ids"),\n',
    '    basis: recommendationBasis(row.basis),\n    userMaterialBasis: stringArray(row.user_material_basis, "user_material_basis"),\n    knowledgeIds: stringArray(row.knowledge_ids, "knowledge_ids"),\n',
)
replace_once(
    "src/recommendation/recommendation-store.ts",
    'const columns = "recommendation_id,conversation_id,run_id,intent_scope_id,intent_version_id,source_message_id,basis,knowledge_ids,claim_ids,recommendation,rationale,tradeoffs,assumptions,uncertainties,alternatives,selection_authorized,created_at";\n',
    'const columns = "recommendation_id,conversation_id,run_id,intent_scope_id,intent_version_id,source_message_id,basis,user_material_basis,knowledge_ids,claim_ids,recommendation,rationale,tradeoffs,assumptions,uncertainties,alternatives,selection_authorized,created_at";\n',
)
replace_once(
    "src/recommendation/recommendation-store.ts",
    '       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16,$17)\n',
    '       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16::jsonb,$17,$18)\n',
)
replace_once(
    "src/recommendation/recommendation-store.ts",
    '        JSON.stringify(record.basis),\n        JSON.stringify(record.knowledgeIds),\n        JSON.stringify(record.claimIds),\n        record.recommendation,\n',
    '        JSON.stringify(record.basis),\n        JSON.stringify(record.userMaterialBasis),\n        JSON.stringify(record.knowledgeIds),\n        JSON.stringify(record.claimIds),\n        record.recommendation,\n',
)

# Stable option identity and user-material recommendation establishment.
replace_once(
    "src/recommendation/recommendation-continuity.ts",
    'import type { IntentVersion } from "../intent/types.js";\n',
    'import type { IntentUserMessage } from "../intent/source-message-store.js";\nimport type { IntentVersion } from "../intent/types.js";\n',
)
replace_once(
    "src/recommendation/recommendation-continuity.ts",
    '} from "./recommendation-store.js";\n',
    '} from "./recommendation-store.js";\nimport { recommendationOptions } from "./recommendation-options.js";\n',
)
replace_once(
    "src/recommendation/recommendation-continuity.ts",
    '    basis,\n    recommendation: input.advisory.recommendation,\n',
    '    basis,\n    userMaterialBasis: [],\n    recommendation: input.advisory.recommendation,\n',
)
marker = '\nexport async function loadRecommendation(\n'
insert = '''\nexport async function establishConversationalRecommendation(input: {\n  store: RecommendationStore;\n  conversationId: string;\n  intentVersion: IntentVersion;\n  sourceMessage: IntentUserMessage;\n  knowledge: LoadedKnowledge[];\n  advisory: SolandraRecommendationResult;\n}): Promise<RecommendationRecord> {\n  if (input.sourceMessage.conversationId !== input.conversationId) {\n    throw new Error("Conversational Recommendation USER source binding changed.");\n  }\n  const loadedById = new Map(input.knowledge.map((item) => [item.record.knowledgeId, item]));\n  const basis: RecommendationBasis[] = input.advisory.basis.map((item) => ({\n    knowledgeId: item.knowledgeId,\n    claimIds: [...item.claimIds],\n  }));\n  for (const basisItem of basis) {\n    const loaded = loadedById.get(basisItem.knowledgeId);\n    if (!loaded || loaded.record.conversationId !== input.conversationId) {\n      throw new Error("Recommendation basis must reference governed Knowledge supplied for the same conversation.");\n    }\n    const allowedClaims = new Set(loaded.record.claimIds);\n    if (basisItem.claimIds.some((claimId) => !allowedClaims.has(claimId))) {\n      throw new Error("Recommendation basis contains a claim outside its governed Knowledge.");\n    }\n  }\n  const draft = buildRecommendationRecord({\n    conversationId: input.conversationId,\n    runId: null,\n    intentScopeId: input.intentVersion.intentScopeId,\n    intentVersionId: input.intentVersion.intentVersionId,\n    sourceMessageId: input.sourceMessage.messageId,\n    basis,\n    userMaterialBasis: [input.intentVersion.intentVersionId, input.sourceMessage.messageId],\n    recommendation: input.advisory.recommendation,\n    rationale: input.advisory.rationale,\n    tradeoffs: input.advisory.tradeoffs,\n    assumptions: input.advisory.assumptions,\n    uncertainties: [...new Set([...input.advisory.preservedUncertainties, ...input.advisory.uncertainties])],\n    alternatives: input.advisory.alternatives,\n    createdAt: input.sourceMessage.createdAt,\n  });\n  return input.store.putRecommendation(draft);\n}\n'''
replace_once("src/recommendation/recommendation-continuity.ts", marker, insert + marker)
replace_once(
    "src/recommendation/recommendation-continuity.ts",
    '  const run = await runStore.get(record.runId);\n  if (!run || !isConsultationRunRequest(run.request) || run.status !== "COMPLETED") {\n    throw new Error("Recommendation source Run could not be reconstructed.");\n  }\n  if (\n    run.conversationId !== record.conversationId\n    || run.request.intentScopeId !== record.intentScopeId\n    || run.request.intentVersionId !== record.intentVersionId\n    || run.request.sourceMessageId !== record.sourceMessageId\n  ) {\n    throw new Error("Recommendation exact Run/Intent/USER-source binding changed.");\n  }\n',
    '  if (record.runId !== null) {\n    const run = await runStore.get(record.runId);\n    if (!run || !isConsultationRunRequest(run.request) || run.status !== "COMPLETED") {\n      throw new Error("Recommendation source Run could not be reconstructed.");\n    }\n    if (\n      run.conversationId !== record.conversationId\n      || run.request.intentScopeId !== record.intentScopeId\n      || run.request.intentVersionId !== record.intentVersionId\n      || run.request.sourceMessageId !== record.sourceMessageId\n    ) {\n      throw new Error("Recommendation exact Run/Intent/USER-source binding changed.");\n    }\n  } else if (record.userMaterialBasis.length === 0) {\n    throw new Error("Run-free Recommendation is missing exact USER-material basis identity.");\n  }\n',
)
replace_once(
    "src/recommendation/recommendation-continuity.ts",
    '  if (record.alternatives.length > 0) sections.push(`Alternatives worth considering:\\n${record.alternatives.map((item) => `- ${item}`).join("\\n")}`);\n',
    '  if (record.alternatives.length > 0) sections.push(`Options discussed:\\n${recommendationOptions(record).map((item) => `${item.position}. ${item.text}${item.recommended ? " (recommended)" : ""}`).join("\\n")}`);\n',
)
replace_once(
    "src/recommendation/recommendation-continuity.ts",
    '  createdAt: string;\n}> {\n',
    '  createdAt: string;\n  options: ReturnType<typeof recommendationOptions>;\n}> {\n',
)
replace_once(
    "src/recommendation/recommendation-continuity.ts",
    '    createdAt: record.createdAt,\n  });\n}\n',
    '    createdAt: record.createdAt,\n    options: recommendationOptions(record),\n  });\n}\n',
)

# Advisory supports pure USER-material decisions while grounding any external factual premise.
replace_once(
    "src/solandra/advisory.ts",
    '  basis: z.array(advisoryBasisSchema).min(1).max(16),\n',
    '  basis: z.array(advisoryBasisSchema).max(16),\n',
)
replace_once(
    "src/solandra/advisory.ts",
    '      basis: [{ knowledgeId: "one supplied Knowledge ID", claimIds: ["supplied claim IDs from that Knowledge"] }],\n',
    '      basis: [{ knowledgeId: "one supplied Knowledge ID", claimIds: ["supplied claim IDs from that Knowledge"] }],\n',
)
replace_once(
    "src/solandra/advisory.ts",
    '          "Every factual basis reference must use only supplied Knowledge IDs and claim IDs. If an external fact is required but not supplied, return NEEDS_KNOWLEDGE instead of inventing it.",\n',
    '          "Every factual basis reference must use only supplied Knowledge IDs and claim IDs. If no external factual premise is needed, a Recommendation may use an empty Knowledge basis and reason only from authoritative USER intent/current USER context. If an external fact is required but not supplied, return NEEDS_KNOWLEDGE instead of inventing it.",\n',
)

# Cognition can resolve exact governed options and distinguish explanation from actual USER choice.
replace_once(
    "src/solandra/cognition.ts",
    '  "SOURCES_RECOMMENDATION",\n  "COGNITIVE_ASSISTANCE",\n',
    '  "SOURCES_RECOMMENDATION",\n  "EXPLAIN_OPTION",\n  "ACCEPT_CHOICE",\n  "COGNITIVE_ASSISTANCE",\n',
)
replace_once(
    "src/solandra/cognition.ts",
    '  referencedRecommendationId: z.string().min(1).max(128).nullable().optional(),\n',
    '  referencedRecommendationId: z.string().min(1).max(128).nullable().optional(),\n  referencedOptionId: z.string().min(1).max(128).nullable().optional(),\n',
)
replace_once(
    "src/solandra/cognition.ts",
    '  readonly createdAt: string;\n}\n',
    '  readonly createdAt: string;\n  readonly options: readonly Readonly<{ optionId: string; position: number; text: string; recommended: boolean }>[];\n}\n',
)
replace_once(
    "src/solandra/cognition.ts",
    '      `Created at: ${item.createdAt}`,\n',
    '      `Created at: ${item.createdAt}`,\n      `Options: ${item.options.map((option) => `[${option.optionId}] position=${option.position} recommended=${option.recommended}: ${option.text}`).join(" | ") || "none"}`,\n',
)
replace_once(
    "src/solandra/cognition.ts",
    '    requestedHelp: "KNOWLEDGE|EXPLAIN_REFERENCE|SIMPLIFY_REFERENCE|SOURCES_REFERENCE|FRESH_RESEARCH|DECISION|EXPLAIN_RECOMMENDATION|SOURCES_RECOMMENDATION|COGNITIVE_ASSISTANCE|RESOURCE",\n',
    '    requestedHelp: "KNOWLEDGE|EXPLAIN_REFERENCE|SIMPLIFY_REFERENCE|SOURCES_REFERENCE|FRESH_RESEARCH|DECISION|EXPLAIN_RECOMMENDATION|SOURCES_RECOMMENDATION|EXPLAIN_OPTION|ACCEPT_CHOICE|COGNITIVE_ASSISTANCE|RESOURCE",\n',
)
replace_once(
    "src/solandra/cognition.ts",
    '    referencedRecommendationId: "one supplied Recommendation ID or null",\n',
    '    referencedRecommendationId: "one supplied Recommendation ID or null",\n    referencedOptionId: "one supplied option ID or null",\n',
)
replace_once(
    "src/solandra/cognition.ts",
    '          "Use EXPLAIN_RECOMMENDATION when the user asks why a supplied historical Recommendation was made. Use SOURCES_RECOMMENDATION when the user asks for the evidence/sources behind it. referencedRecommendationId must be exactly one supplied Recommendation ID or null.",\n',
    '          "Use EXPLAIN_RECOMMENDATION when the user asks why a supplied historical Recommendation was made. Use SOURCES_RECOMMENDATION when the user asks for the evidence/sources behind it. referencedRecommendationId must be exactly one supplied Recommendation ID or null.",\n          "Use EXPLAIN_OPTION when the user refers conversationally to one exact supplied option and asks about it without choosing it. Use ACCEPT_CHOICE only when the USER actually chooses one supplied option and exact choice identity matters. For either, return both its exact supplied Recommendation ID and option ID. Resolve references from context and supplied option identity, not from a phrase-specific command. If the intended option is materially ambiguous, ask a precise clarification instead of guessing.",\n',
)
needle = '''    if (recommendationReferenceHelp(proposal.requestedHelp) && referencedRecommendationId === null && proposal.materialAmbiguity === null) {\n      throw new ModelProviderError(\n        "invalid_output",\n        "A Recommendation reference proposal must identify supplied Recommendation or surface ambiguity.",\n      );\n    }\n'''
addition = needle + '''    const optionToRecommendation = new Map<string, string>();\n    for (const recommendation of input.governedRecommendations ?? []) {\n      for (const option of recommendation.options) optionToRecommendation.set(option.optionId, recommendation.recommendationId);\n    }\n    const referencedOptionId = proposal.referencedOptionId ?? null;\n    if (referencedOptionId !== null && !optionToRecommendation.has(referencedOptionId)) {\n      throw new ModelProviderError("invalid_output", "Solandra cognition referenced an option that Lattice did not supply.");\n    }\n    if ((proposal.requestedHelp === "EXPLAIN_OPTION" || proposal.requestedHelp === "ACCEPT_CHOICE") && proposal.materialAmbiguity === null) {\n      if (referencedRecommendationId === null || referencedOptionId === null) {\n        throw new ModelProviderError("invalid_output", "An option reference proposal must identify supplied Recommendation and option or surface ambiguity.");\n      }\n      if (optionToRecommendation.get(referencedOptionId) !== referencedRecommendationId) {\n        throw new ModelProviderError("invalid_output", "Solandra cognition bound an option to the wrong Recommendation.");\n      }\n    }\n'''
replace_once("src/solandra/cognition.ts", needle, addition)

# Consultation path: exact option resolution/AcceptedChoice and run-free preference-only Recommendation.
replace_once(
    "src/consultation-intake.ts",
    'import type { ConversationStore } from "./conversation/conversation-store.js";\n',
    'import type { ConversationStore } from "./conversation/conversation-store.js";\nimport { buildAcceptedChoiceRecord, type AcceptedChoiceStore } from "./intent/accepted-choice-store.js";\n',
)
replace_once(
    "src/consultation-intake.ts",
    '  establishRecommendation,\n',
    '  establishRecommendation,\n  establishConversationalRecommendation,\n',
)
replace_once(
    "src/consultation-intake.ts",
    '} from "./recommendation/recommendation-continuity.js";\n',
    '} from "./recommendation/recommendation-continuity.js";\nimport { recommendationOption, recommendationOptions } from "./recommendation/recommendation-options.js";\n',
)
replace_once(
    "src/consultation-intake.ts",
    '  recommendationStore?: RecommendationStore;\n',
    '  recommendationStore?: RecommendationStore;\n  acceptedChoiceStore?: AcceptedChoiceStore;\n',
)
replace_once(
    "src/consultation-intake.ts",
    '    referencedRecommendationId: result.proposal.referencedRecommendationId ?? null,\n',
    '    referencedRecommendationId: result.proposal.referencedRecommendationId ?? null,\n    referencedOptionId: result.proposal.referencedOptionId ?? null,\n',
)
replace_once(
    "src/consultation-intake.ts",
    'function isRecommendationReferenceHelp(help: SolandraRequestedHelp): boolean {\n  return help === "EXPLAIN_RECOMMENDATION" || help === "SOURCES_RECOMMENDATION";\n}\n',
    'function isRecommendationReferenceHelp(help: SolandraRequestedHelp): boolean {\n  return help === "EXPLAIN_RECOMMENDATION" || help === "SOURCES_RECOMMENDATION";\n}\n\nfunction isOptionReferenceHelp(help: SolandraRequestedHelp): boolean {\n  return help === "EXPLAIN_OPTION" || help === "ACCEPT_CHOICE";\n}\n',
)
anchor = '''      if (\n        cognition\n        && isRecommendationReferenceHelp(cognition.proposal.requestedHelp)\n'''
option_block = '''      if (\n        cognition\n        && isOptionReferenceHelp(cognition.proposal.requestedHelp)\n        && cognition.proposal.materialAmbiguity === null\n        && (cognition.proposal.referencedRecommendationId ?? null) !== null\n        && (cognition.proposal.referencedOptionId ?? null) !== null\n      ) {\n        if (!options.recommendationStore || !options.knowledgeStore || !currentVersion) {\n          return reply.status(409).send({ error: "GOVERNED_OPTION_REFERENCE_UNAVAILABLE" });\n        }\n        const loaded = await loadRecommendation(\n          options.recommendationStore,\n          options.knowledgeStore,\n          options.runStore,\n          cognition.proposal.referencedRecommendationId!,\n        );\n        if (!loaded || loaded.record.conversationId !== conversationId) {\n          return reply.status(404).send({ error: "RECOMMENDATION_NOT_FOUND" });\n        }\n        const option = recommendationOption(loaded.record, cognition.proposal.referencedOptionId!);\n        if (!option) return reply.status(404).send({ error: "RECOMMENDATION_OPTION_NOT_FOUND" });\n        if (cognition.proposal.requestedHelp === "EXPLAIN_OPTION") {\n          return reply.status(200).send({\n            status: "OPTION_REFERENCE_RESOLVED",\n            acceptedUnderstanding: authoritativeObjective(currentVersion),\n            intentScopeId,\n            intentVersionId: currentVersion.intentVersionId,\n            recommendationReference: { recommendationId: loaded.record.recommendationId },\n            optionReference: option,\n            presentation: {\n              assistantMessage: `${option.text}\\n\\nThis is option ${option.position} from the exact prior Recommendation. Its historical Recommendation basis and uncertainty remain unchanged.`,\n            },\n            interpretation: publicCognition(cognition),\n          });\n        }\n        if (!options.acceptedChoiceStore) {\n          return reply.status(409).send({ error: "ACCEPTED_CHOICE_STORE_UNAVAILABLE" });\n        }\n        if (loaded.record.intentVersionId !== currentVersion.intentVersionId) {\n          return reply.status(409).send({\n            error: "ACCEPTED_CHOICE_BASIS_STALE",\n            message: "That option belongs to an earlier Recommendation basis. Revisit the current Recommendation before preserving it as your choice.",\n          });\n        }\n        const choice = buildAcceptedChoiceRecord({\n          conversationId,\n          intentScopeId,\n          intentVersionId: currentVersion.intentVersionId,\n          recommendationId: loaded.record.recommendationId,\n          optionId: option.optionId,\n          optionText: option.text,\n          sourceMessageId: sourceMessage.messageId,\n          sourceMessageDigest: sourceMessage.contentDigest,\n          createdAt: sourceMessage.createdAt,\n        });\n        let acceptedChoice;\n        try {\n          acceptedChoice = await options.acceptedChoiceStore.putAcceptedChoice(choice);\n        } catch (error) {\n          const message = error instanceof Error ? error.message : "Accepted USER choice could not be preserved.";\n          return reply.status(409).send({ error: "ACCEPTED_CHOICE_CONFLICT", message });\n        }\n        return reply.status(200).send({\n          status: "ACCEPTED_CHOICE_ESTABLISHED",\n          acceptedUnderstanding: authoritativeObjective(currentVersion),\n          intentScopeId,\n          intentVersionId: currentVersion.intentVersionId,\n          recommendationReference: { recommendationId: loaded.record.recommendationId },\n          optionReference: option,\n          acceptedChoice,\n          presentation: { assistantMessage: `You chose: ${option.text}\\n\\nI preserved that as your choice. It does not authorize any external action.` },\n          interpretation: publicCognition(cognition),\n        });\n      }\n\n'''
replace_once("src/consultation-intake.ts", anchor, option_block + anchor)

qual_anchor = '''      const qualification = interpretation.decisionRequested\n        ? qualifiedDecisionNeed(version, options.criterionCatalog)\n        : { decisionNeed: "NONE" as const };\n'''
direct_block = '''      if (\n        cognition?.proposal.requestedHelp === "DECISION"\n        && cognition.proposal.materialAmbiguity === null\n        && cognition.proposal.knowledgeNeeds.length === 0\n        && options.recommendationStore\n        && options.solandraAdvisory\n      ) {\n        const governed = options.knowledgeStore\n          ? await recentGovernedKnowledge(options.knowledgeStore, options.runStore, conversationId, 4)\n          : [];\n        let advisory;\n        try {\n          advisory = await options.solandraAdvisory.advise({\n            conversationId,\n            userMessageId: sourceMessage.messageId,\n            authoritativeIntent: version,\n            authoritativeObjective: authoritativeObjective(version),\n            userContext: [sourceMessage.content],\n            knowledge: governed.map(advisoryKnowledge),\n          });\n        } catch (error) {\n          const message = error instanceof Error ? error.message : "Solandra advisory reasoning failed.";\n          return reply.status(422).send({ error: "SOLANDRA_ADVISORY_FAILED", message });\n        }\n        if (advisory.result.status === "RECOMMENDATION") {\n          const recommendation = await establishConversationalRecommendation({\n            store: options.recommendationStore,\n            conversationId,\n            intentVersion: version,\n            sourceMessage,\n            knowledge: governed,\n            advisory: advisory.result,\n          });\n          return reply.status(200).send({\n            status: "RECOMMENDATION_ESTABLISHED",\n            acceptedUnderstanding: authoritativeObjective(version),\n            intentScopeId,\n            intentVersionId: version.intentVersionId,\n            recommendationReference: {\n              recommendationId: recommendation.recommendationId,\n              intentVersionId: recommendation.intentVersionId,\n              knowledgeIds: recommendation.knowledgeIds,\n              claimIds: recommendation.claimIds,\n              options: recommendationOptions(recommendation),\n              selectionAuthorized: false,\n            },\n            presentation: { assistantMessage: renderRecommendation(recommendation) },\n            interpretation: publicCognition(cognition),\n          });\n        }\n        if (advisory.result.status === "NEEDS_CLARIFICATION") {\n          return reply.status(202).send({\n            status: "NEEDS_CLARIFICATION",\n            acceptedUnderstanding: authoritativeObjective(version),\n            intentScopeId,\n            intentVersionId: version.intentVersionId,\n            question: advisory.result.question,\n            confirmationExample: null,\n            interpretation: publicCognition(cognition),\n          });\n        }\n        if (advisory.result.status === "INSUFFICIENT_BASIS") {\n          return reply.status(200).send({\n            status: "ADVISORY_INSUFFICIENT_BASIS",\n            acceptedUnderstanding: authoritativeObjective(version),\n            intentScopeId,\n            intentVersionId: version.intentVersionId,\n            advisory: advisory.result,\n            presentation: { assistantMessage: `I don't have a sufficient basis for a responsible recommendation. ${advisory.result.reason}` },\n            interpretation: publicCognition(cognition),\n          });\n        }\n      }\n\n'''
replace_once("src/consultation-intake.ts", qual_anchor, direct_block + qual_anchor)
replace_once(
    "src/consultation-intake.ts",
    '            selectionAuthorized: existing.record.selectionAuthorized,\n',
    '            options: recommendationOptions(existing.record),\n            selectionAuthorized: existing.record.selectionAuthorized,\n',
)
replace_once(
    "src/consultation-intake.ts",
    '          selectionAuthorized: recommendation.selectionAuthorized,\n',
    '          options: recommendationOptions(recommendation),\n          selectionAuthorized: recommendation.selectionAuthorized,\n',
)

# Continuity exposes durable choices and exact option identities downstream of authority.
replace_once(
    "src/conversation/continuity-api.ts",
    'import { getAuthenticatedSubject } from "../auth/authenticated-subject.js";\n',
    'import { getAuthenticatedSubject } from "../auth/authenticated-subject.js";\nimport type { AcceptedChoiceStore } from "../intent/accepted-choice-store.js";\n',
)
replace_once(
    "src/conversation/continuity-api.ts",
    'import type { RecommendationStore } from "../recommendation/recommendation-store.js";\n',
    'import type { RecommendationStore } from "../recommendation/recommendation-store.js";\nimport { recommendationOptions } from "../recommendation/recommendation-options.js";\n',
)
replace_once(
    "src/conversation/continuity-api.ts",
    '  recommendationStore?: RecommendationStore;\n',
    '  recommendationStore?: RecommendationStore;\n  acceptedChoiceStore?: AcceptedChoiceStore;\n',
)
replace_once(
    "src/conversation/continuity-api.ts",
    '      const [messages, runIds, knowledge, references, recommendations] = await Promise.all([\n',
    '      const [messages, runIds, knowledge, references, recommendations, acceptedChoices] = await Promise.all([\n',
)
replace_once(
    "src/conversation/continuity-api.ts",
    '        options.recommendationStore?.listRecommendationsByConversation(conversationId) ?? Promise.resolve([]),\n      ]);\n',
    '        options.recommendationStore?.listRecommendationsByConversation(conversationId) ?? Promise.resolve([]),\n        options.acceptedChoiceStore?.listAcceptedChoicesByConversation(conversationId) ?? Promise.resolve([]),\n      ]);\n',
)
replace_once(
    "src/conversation/continuity-api.ts",
    '          basis: record.basis,\n          knowledgeIds: record.knowledgeIds,\n',
    '          basis: record.basis,\n          userMaterialBasis: record.userMaterialBasis,\n          knowledgeIds: record.knowledgeIds,\n',
)
replace_once(
    "src/conversation/continuity-api.ts",
    '          alternatives: record.alternatives,\n          selectionAuthorized: record.selectionAuthorized,\n',
    '          alternatives: record.alternatives,\n          options: recommendationOptions(record),\n          selectionAuthorized: record.selectionAuthorized,\n',
)
replace_once(
    "src/conversation/continuity-api.ts",
    '        })),\n      });\n',
    '        })),\n        acceptedChoices: acceptedChoices.map((choice) => ({ ...choice })),\n      });\n',
)

# Runtime composition owns the small AcceptedChoice trust store.
replace_once(
    "src/runtime-app.ts",
    'import { PostgresCapabilityAuthorizationStore } from "./capabilities/authorization-store.js";\n',
    'import { PostgresCapabilityAuthorizationStore } from "./capabilities/authorization-store.js";\nimport {\n  MemoryAcceptedChoiceStore,\n  PostgresAcceptedChoiceStore,\n  type AcceptedChoiceStore,\n} from "./intent/accepted-choice-store.js";\n',
)
replace_once(
    "src/runtime-app.ts",
    '  recommendationStore?: RecommendationStore;\n',
    '  recommendationStore?: RecommendationStore;\n  acceptedChoiceStore?: AcceptedChoiceStore;\n',
)
replace_once(
    "src/runtime-app.ts",
    '  await PostgresCapabilityAuthorizationStore.migrate(databaseUrl);\n',
    '  await PostgresCapabilityAuthorizationStore.migrate(databaseUrl);\n  await PostgresAcceptedChoiceStore.migrate(databaseUrl);\n',
)
replace_once(
    "src/runtime-app.ts",
    '  recommendationStore: RecommendationStore;\n  preparedResourceStore: PreparedResourceStore;\n}> {\n',
    '  recommendationStore: RecommendationStore;\n  acceptedChoiceStore: AcceptedChoiceStore;\n  preparedResourceStore: PreparedResourceStore;\n}> {\n',
)
old_nested = '''                    const recommendationStore = await PostgresRecommendationStore.connect(databaseUrl);\n                    try {\n                      const preparedResourceStore = await PostgresPreparedResourceStore.connect(databaseUrl);\n                      const decisionPlanControl = new DecisionPlanRecordingApiRunControlStore(baseApiControlStore, decisionPlanStore);\n                      const apiControlStore = new ConversationRunIndexRecordingApiRunControlStore(decisionPlanControl, runIndexStore);\n                      return {\n                        runStore,\n                        apiControlStore,\n                        intentStore,\n                        userMessageStore,\n                        userPreferenceStore,\n                        conversationStore,\n                        decisionPlanStore,\n                        runIndexStore,\n                        knowledgeStore,\n                        recommendationStore,\n                        preparedResourceStore,\n                      };\n                    } catch (error) {\n                      await recommendationStore.close();\n                      throw error;\n                    }\n'''
new_nested = '''                    const recommendationStore = await PostgresRecommendationStore.connect(databaseUrl);\n                    try {\n                      const acceptedChoiceStore = await PostgresAcceptedChoiceStore.connect(databaseUrl);\n                      try {\n                        const preparedResourceStore = await PostgresPreparedResourceStore.connect(databaseUrl);\n                        const decisionPlanControl = new DecisionPlanRecordingApiRunControlStore(baseApiControlStore, decisionPlanStore);\n                        const apiControlStore = new ConversationRunIndexRecordingApiRunControlStore(decisionPlanControl, runIndexStore);\n                        return {\n                          runStore,\n                          apiControlStore,\n                          intentStore,\n                          userMessageStore,\n                          userPreferenceStore,\n                          conversationStore,\n                          decisionPlanStore,\n                          runIndexStore,\n                          knowledgeStore,\n                          recommendationStore,\n                          acceptedChoiceStore,\n                          preparedResourceStore,\n                        };\n                      } catch (error) {\n                        await acceptedChoiceStore.close();\n                        throw error;\n                      }\n                    } catch (error) {\n                      await recommendationStore.close();\n                      throw error;\n                    }\n'''
replace_once("src/runtime-app.ts", old_nested, new_nested)
replace_once(
    "src/runtime-app.ts",
    '  let recommendationStore: RecommendationStore;\n  let preparedResourceStore: PreparedResourceStore;\n',
    '  let recommendationStore: RecommendationStore;\n  let acceptedChoiceStore: AcceptedChoiceStore;\n  let preparedResourceStore: PreparedResourceStore;\n',
)
replace_once(
    "src/runtime-app.ts",
    '      recommendationStore,\n      preparedResourceStore,\n',
    '      recommendationStore,\n      acceptedChoiceStore,\n      preparedResourceStore,\n',
)
replace_once(
    "src/runtime-app.ts",
    '    const memoryRecommendationStore = options.recommendationStore ?? new MemoryRecommendationStore();\n    const memoryPreparedResourceStore = options.preparedResourceStore ?? new MemoryPreparedResourceStore();\n',
    '    const memoryRecommendationStore = options.recommendationStore ?? new MemoryRecommendationStore();\n    const memoryAcceptedChoiceStore = options.acceptedChoiceStore ?? new MemoryAcceptedChoiceStore();\n    const memoryPreparedResourceStore = options.preparedResourceStore ?? new MemoryPreparedResourceStore();\n',
)
replace_once(
    "src/runtime-app.ts",
    '    recommendationStore = memoryRecommendationStore;\n    preparedResourceStore = memoryPreparedResourceStore;\n',
    '    recommendationStore = memoryRecommendationStore;\n    acceptedChoiceStore = memoryAcceptedChoiceStore;\n    preparedResourceStore = memoryPreparedResourceStore;\n',
)
replace_once(
    "src/runtime-app.ts",
    '    recommendationStore,\n    preparedResourceStore,\n    ...(options.consultationInterpreter',
    '    recommendationStore,\n    acceptedChoiceStore,\n    preparedResourceStore,\n    ...(options.consultationInterpreter',
)
replace_once(
    "src/runtime-app.ts",
    '    recommendationStore,\n    preparedResourceStore,\n  });\n',
    '    recommendationStore,\n    acceptedChoiceStore,\n    preparedResourceStore,\n  });\n',
)
replace_once(
    "src/runtime-app.ts",
    '    await preparedResourceStore.close();\n    await recommendationStore.close();\n',
    '    await preparedResourceStore.close();\n    await acceptedChoiceStore.close();\n    await recommendationStore.close();\n',
)

# Browser treats direct Recommendation/option/choice responses as ordinary Solandra turns.
replace_once(
    "src/ui/solandra-conversation-page.ts",
    '        if (body.status === "RECOMMENDATION_REFERENCE_RESOLVED") {\n',
    '        if (["RECOMMENDATION_ESTABLISHED", "RECOMMENDATION_REFERENCE_RESOLVED", "OPTION_REFERENCE_RESOLVED", "ACCEPTED_CHOICE_ESTABLISHED", "ADVISORY_INSUFFICIENT_BASIS"].includes(body.status)) {\n',
)

# Focused public M4 development probes. These are fixtures, not held-out evidence.
write("test/m4-general-decision-journey.test.ts", '''import assert from "node:assert/strict";\nimport test from "node:test";\nimport type { FastifyRequest } from "fastify";\nimport { createRuntimeApp } from "../src/runtime-app.js";\nimport { resolveRuntimeConfig } from "../src/runtime-config.js";\nimport type { ModelInvocationProvenance } from "../src/model/types.js";\nimport type { SolandraAdvisoryInput, SolandraAdvisoryRuntime, SolandraAdvisoryRuntimeResult } from "../src/solandra/advisory.js";\nimport type { SolandraCognitionInput, SolandraCognitionResult, SolandraCognitiveRuntime, SolandraSemanticProposal } from "../src/solandra/cognition.js";\n\nconst PROVENANCE: ModelInvocationProvenance = Object.freeze({\n  executionClass: "LOCAL_OFFLINE", routeMode: "PINNED", requestedProvider: "m4-fixture", requestedModel: "m4-fixture-model",\n  actualProvider: "m4-fixture", actualModel: "m4-fixture-model", brokerIdentity: null, brokerVersion: null,\n  upstreamRequestId: "m4-fixture", routeProvenance: "COMPLETE",\n});\n\nfunction proposal(overrides: Partial<SolandraSemanticProposal> = {}): SolandraSemanticProposal {\n  return {\n    objectiveRelation: "CONTINUE", proposedObjective: null, requestedHelp: "DECISION", relevantContext: [], entities: [], referents: [],\n    constraints: [], preferences: [], knowledgeNeeds: [], materialAmbiguity: null, referencedKnowledgeId: null,\n    referencedRecommendationId: null, referencedOptionId: null, ...overrides,\n  };\n}\n\nclass GeneralDecisionCognition implements SolandraCognitiveRuntime {\n  async interpret(input: SolandraCognitionInput): Promise<SolandraCognitionResult> {\n    const recommendation = input.governedRecommendations?.at(-1);\n    if (/more about/iu.test(input.message)) {\n      return { proposal: proposal({ requestedHelp: "EXPLAIN_OPTION", referencedRecommendationId: recommendation?.recommendationId ?? null, referencedOptionId: recommendation?.options[1]?.optionId ?? null }), invocationProvenance: PROVENANCE };\n    }\n    if (/go with/iu.test(input.message)) {\n      return { proposal: proposal({ requestedHelp: "ACCEPT_CHOICE", referencedRecommendationId: recommendation?.recommendationId ?? null, referencedOptionId: recommendation?.options[1]?.optionId ?? null }), invocationProvenance: PROVENANCE };\n    }\n    return { proposal: proposal({ objectiveRelation: input.currentObjective ? "CONTINUE" : "NEW_OBJECTIVE", proposedObjective: input.currentObjective ? null : input.message, preferences: ["keep upkeep light"] }), invocationProvenance: PROVENANCE };\n  }\n}\n\nclass UserMaterialAdvisory implements SolandraAdvisoryRuntime {\n  calls: SolandraAdvisoryInput[] = [];\n  async advise(input: SolandraAdvisoryInput): Promise<SolandraAdvisoryRuntimeResult> {\n    this.calls.push(structuredClone(input));\n    return {\n      result: {\n        status: "RECOMMENDATION", recommendation: "Use a lightweight weekly review.", basis: [],\n        rationale: ["It directly matches the USER preference for lower upkeep."], tradeoffs: ["Less structure may mean occasional manual cleanup."],\n        assumptions: ["The USER values lower maintenance over tighter daily structure."], uncertainties: [], preservedUncertainties: [],\n        alternatives: ["Keep the current ad-hoc approach.", "Use a structured daily review."],\n      },\n      invocationProvenance: PROVENANCE,\n    };\n  }\n}\n\nconst config = resolveRuntimeConfig({\n  LATTICE_DEPLOYMENT_MODE: "development",\n  LATTICE_TRUTH_MODE: "v36-offline",\n  LATTICE_AUTHENTICATION_MODE: "development-fixture",\n  LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "m4-user",\n} as NodeJS.ProcessEnv);\n\ntest("ordinary USER-value decision reaches durable advisory Recommendation without formal run/Decision Engine and preserves exact option choice", async () => {\n  const advisory = new UserMaterialAdvisory();\n  const app = await createRuntimeApp(config, { memoryDispatchDelayMs: 1, solandraCognition: new GeneralDecisionCognition(), solandraAdvisory: advisory });\n  try {\n    const created = await app.inject({ method: "POST", url: "/api/v1/conversations" });\n    const conversationId = created.json().conversation.id as string;\n    const first = await app.inject({ method: "POST", url: `/api/v1/conversations/${conversationId}/turns`, payload: { turnId: "m4-turn-1", message: "Help me choose a simple way to review my rough project notes; I care most about keeping upkeep light." } });\n    assert.equal(first.statusCode, 200, first.body);\n    const firstBody = first.json();\n    assert.equal(firstBody.status, "RECOMMENDATION_ESTABLISHED");\n    assert.equal(firstBody.interpretation.requestedHelp, "DECISION");\n    assert.equal(firstBody.recommendationReference.selectionAuthorized, false);\n    assert.equal(firstBody.recommendationReference.options.length, 3);\n    assert.equal(advisory.calls.length, 1);\n    assert.deepEqual(advisory.calls[0]?.knowledge, []);\n\n    let continuity = (await app.inject({ method: "GET", url: `/api/v1/conversations/${conversationId}/continuity` })).json();\n    assert.equal(continuity.runs.length, 0, "ordinary USER-material advice must not force a formal/Truth Run");\n    assert.equal(continuity.recommendations.length, 1);\n    assert.equal(continuity.recommendations[0].runId, null);\n    assert.deepEqual(continuity.recommendations[0].knowledgeIds, []);\n    assert.equal(continuity.acceptedChoices.length, 0);\n\n    const explain = await app.inject({ method: "POST", url: `/api/v1/conversations/${conversationId}/turns`, payload: { turnId: "m4-turn-2", message: "Tell me more about the second option." } });\n    assert.equal(explain.statusCode, 200, explain.body);\n    assert.equal(explain.json().status, "OPTION_REFERENCE_RESOLVED");\n    const optionId = explain.json().optionReference.optionId;\n    assert.equal(optionId, firstBody.recommendationReference.options[1].optionId);\n\n    const choose = await app.inject({ method: "POST", url: `/api/v1/conversations/${conversationId}/turns`, payload: { turnId: "m4-turn-3", message: "I'll go with that one." } });\n    assert.equal(choose.statusCode, 200, choose.body);\n    const choice = choose.json().acceptedChoice;\n    assert.equal(choose.json().status, "ACCEPTED_CHOICE_ESTABLISHED");\n    assert.equal(choice.optionId, optionId);\n    assert.equal(choice.recommendationId, firstBody.recommendationReference.recommendationId);\n    assert.equal(choice.authorizationGranted, false);\n    assert.equal(choice.executionAuthorized, false);\n\n    continuity = (await app.inject({ method: "GET", url: `/api/v1/conversations/${conversationId}/continuity` })).json();\n    assert.equal(continuity.acceptedChoices.length, 1);\n    assert.equal(continuity.acceptedChoices[0].sourceMessageId, choice.sourceMessageId);\n    assert.deepEqual(continuity.messages.map((message: { content: string }) => message.content), [\n      "Help me choose a simple way to review my rough project notes; I care most about keeping upkeep light.",\n      "Tell me more about the second option.",\n      "I'll go with that one.",\n    ]);\n  } finally { await app.close(); }\n});\n\nclass AmbiguousCognition implements SolandraCognitiveRuntime {\n  async interpret(input: SolandraCognitionInput): Promise<SolandraCognitionResult> {\n    return { proposal: proposal({ objectiveRelation: input.currentObjective ? "CONTINUE" : "NEW_OBJECTIVE", proposedObjective: input.currentObjective ? null : input.message, materialAmbiguity: { question: "Do you mean the lower-cost option now or the lower-effort option over time?", couldChangeObjective: true } }), invocationProvenance: PROVENANCE };\n  }\n}\n\ntest("material decision ambiguity clarifies without fabricating Recommendation or choice", async () => {\n  const advisory = new UserMaterialAdvisory();\n  const app = await createRuntimeApp(config, { memoryDispatchDelayMs: 1, solandraCognition: new AmbiguousCognition(), solandraAdvisory: advisory });\n  try {\n    const created = await app.inject({ method: "POST", url: "/api/v1/conversations" });\n    const conversationId = created.json().conversation.id as string;\n    const response = await app.inject({ method: "POST", url: `/api/v1/conversations/${conversationId}/turns`, payload: { turnId: "ambiguous-1", message: "Which one is better for me?" } });\n    assert.equal(response.statusCode, 202, response.body);\n    assert.equal(response.json().status, "NEEDS_CLARIFICATION");\n    assert.equal(advisory.calls.length, 0);\n    const continuity = (await app.inject({ method: "GET", url: `/api/v1/conversations/${conversationId}/continuity` })).json();\n    assert.equal(continuity.recommendations.length, 0);\n    assert.equal(continuity.acceptedChoices.length, 0);\n  } finally { await app.close(); }\n});\n''')

write("test/m4-postgres-decision-continuity.test.ts", '''import assert from "node:assert/strict";\nimport test from "node:test";\nimport type { ModelInvocationProvenance } from "../src/model/types.js";\nimport { createRuntimeApp } from "../src/runtime-app.js";\nimport { resolveRuntimeConfig } from "../src/runtime-config.js";\nimport type { SolandraAdvisoryRuntime } from "../src/solandra/advisory.js";\nimport type { SolandraCognitiveRuntime, SolandraSemanticProposal } from "../src/solandra/cognition.js";\n\nconst databaseUrl = process.env.DATABASE_URL;\nconst P: ModelInvocationProvenance = { executionClass: "LOCAL_OFFLINE", routeMode: "PINNED", requestedProvider: "m4", requestedModel: "m4", actualProvider: "m4", actualModel: "m4", brokerIdentity: null, brokerVersion: null, upstreamRequestId: "m4", routeProvenance: "COMPLETE" };\nfunction proposal(overrides: Partial<SolandraSemanticProposal> = {}): SolandraSemanticProposal { return { objectiveRelation: "CONTINUE", proposedObjective: null, requestedHelp: "DECISION", relevantContext: [], entities: [], referents: [], constraints: [], preferences: [], knowledgeNeeds: [], materialAmbiguity: null, referencedKnowledgeId: null, referencedRecommendationId: null, referencedOptionId: null, ...overrides }; }\nclass C implements SolandraCognitiveRuntime { async interpret(input: Parameters<SolandraCognitiveRuntime["interpret"]>[0]) { const r = input.governedRecommendations?.at(-1); if (/choose/iu.test(input.message)) return { proposal: proposal({ requestedHelp: "ACCEPT_CHOICE", referencedRecommendationId: r?.recommendationId ?? null, referencedOptionId: r?.options[1]?.optionId ?? null }), invocationProvenance: P }; return { proposal: proposal({ objectiveRelation: input.currentObjective ? "CONTINUE" : "NEW_OBJECTIVE", proposedObjective: input.currentObjective ? null : input.message }), invocationProvenance: P }; } }\nconst advisory: SolandraAdvisoryRuntime = { async advise() { return { result: { status: "RECOMMENDATION", recommendation: "Keep the lighter routine.", basis: [], rationale: ["Matches USER preference."], tradeoffs: [], assumptions: [], uncertainties: [], preservedUncertainties: [], alternatives: ["Use the more structured routine."] }, invocationProvenance: P }; } };\n\ntest("PostgreSQL persists run-free Recommendation and AcceptedChoice across restart", { skip: !databaseUrl }, async () => {\n  const config = resolveRuntimeConfig({ LATTICE_DEPLOYMENT_MODE: "development", LATTICE_TRUTH_MODE: "v36-offline", LATTICE_DATABASE_URL: databaseUrl!, LATTICE_AUTO_MIGRATE: "true", LATTICE_AUTHENTICATION_MODE: "development-fixture", LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "m4-pg-user" } as NodeJS.ProcessEnv);\n  let first = await createRuntimeApp(config, { solandraCognition: new C(), solandraAdvisory: advisory });\n  let conversationId = "";\n  let choiceId = "";\n  try {\n    const created = await first.inject({ method: "POST", url: "/api/v1/conversations" }); conversationId = created.json().conversation.id;\n    const rec = await first.inject({ method: "POST", url: `/api/v1/conversations/${conversationId}/turns`, payload: { turnId: "pg-1", message: "Help me pick a low-upkeep routine." } });\n    assert.equal(rec.statusCode, 200, rec.body);\n    const chosen = await first.inject({ method: "POST", url: `/api/v1/conversations/${conversationId}/turns`, payload: { turnId: "pg-2", message: "I choose the other option." } });\n    assert.equal(chosen.statusCode, 200, chosen.body); choiceId = chosen.json().acceptedChoice.acceptedChoiceId;\n  } finally { await first.close(); }\n\n  const restartConfig = resolveRuntimeConfig({ LATTICE_DEPLOYMENT_MODE: "development", LATTICE_TRUTH_MODE: "v36-offline", LATTICE_DATABASE_URL: databaseUrl!, LATTICE_AUTO_MIGRATE: "false", LATTICE_AUTHENTICATION_MODE: "development-fixture", LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "m4-pg-user" } as NodeJS.ProcessEnv);\n  const second = await createRuntimeApp(restartConfig, { solandraCognition: new C(), solandraAdvisory: advisory });\n  try {\n    const continuity = await second.inject({ method: "GET", url: `/api/v1/conversations/${conversationId}/continuity` });\n    assert.equal(continuity.statusCode, 200, continuity.body);\n    assert.equal(continuity.json().recommendations.length, 1);\n    assert.equal(continuity.json().recommendations[0].runId, null);\n    assert.equal(continuity.json().acceptedChoices.length, 1);\n    assert.equal(continuity.json().acceptedChoices[0].acceptedChoiceId, choiceId);\n    assert.equal(continuity.json().acceptedChoices[0].authorizationGranted, false);\n  } finally { await second.close(); }\n});\n''')

print("M4 patch applied")
