import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";

const migrations = [
  "034_recommendations.sql",
  "038_recommendation_structural_representation.sql",
] as const;

export type RecommendationRepresentationKind =
  | "LEGACY_FREEFORM"
  | "STRUCTURAL_ADVISORY_V1"
  | "STRUCTURAL_PROPOSAL_V2";

export interface RecommendationBasis {
  knowledgeId: string;
  claimIds: string[];
}

export interface RecommendationUserPremise {
  intentVersionId: string;
  sourceMessageId: string;
}

export interface RecommendationPremiseAuthority {
  knowledge: RecommendationBasis[];
  user: RecommendationUserPremise[];
}

export type RecommendationProposal = Readonly<{
  proposalId: string;
  origin: "SOLANDRA" | "LEGACY_UNCLASSIFIED";
  factualAuthority: false;
  text: string;
}>;

export interface RecommendationRecord {
  recommendationId: string;
  conversationId: string;
  runId: string | null;
  intentScopeId: string;
  intentVersionId: string;
  sourceMessageId: string;
  basis: RecommendationBasis[];
  userMaterialBasis: string[];
  /** Exact premise authority. Proposal wording cannot add to this set. */
  premiseAuthority: RecommendationPremiseAuthority;
  knowledgeIds: string[];
  claimIds: string[];
  /**
   * STRUCTURAL_PROPOSAL_V2 makes the durable Recommendation a governed
   * relationship over typed proposal identities rather than free-form proposal
   * prose. STRUCTURAL_ADVISORY_V1 remains readable for candidate continuity;
   * LEGACY_FREEFORM remains fail-closed.
   */
  representationKind: RecommendationRepresentationKind;
  /** Model-originated proposal material. Persistence does not grant factual authority. */
  proposals: RecommendationProposal[];
  /** Recommendation ranking is over proposal identity, not proposal wording. */
  recommendedProposalId: string;
  rankedProposalIds: string[];
  /** Deterministic rendering of exact governed claim content only. */
  rationale: string[];
  /** Must remain empty for structural Recommendation records. */
  tradeoffs: string[];
  /** Exact USER-authored premise excerpts only. */
  assumptions: string[];
  /** Exact governed uncertainty strings only. */
  uncertainties: string[];
  selectionAuthorized: false;
  createdAt: string;
}

export interface RecommendationStore {
  readonly kind: "memory" | "postgres";
  putRecommendation(record: RecommendationRecord): Promise<RecommendationRecord>;
  getRecommendation(recommendationId: string): Promise<RecommendationRecord | undefined>;
  getRecommendationByRunId(runId: string): Promise<RecommendationRecord | undefined>;
  listRecommendationsByConversation(conversationId: string): Promise<RecommendationRecord[]>;
  close(): Promise<void>;
}

function stableId(prefix: string, ...parts: string[]): string {
  const digest = createHash("sha256").update(parts.join("\u001f")).digest("hex");
  return `${prefix}_${digest.slice(0, 40)}`;
}

/** New proposal identity is independent of arbitrary proposal wording. */
export function recommendationProposalId(recommendationId: string, position: number): string {
  return stableId("recommendation_proposal", recommendationId, String(position));
}

/** Candidate/legacy compatibility only; preserves pre-V2 option identity. */
function legacyRecommendationOptionId(recommendationId: string, position: number, text: string): string {
  const digest = createHash("sha256")
    .update([recommendationId, String(position), text].join("\u001f"))
    .digest("hex")
    .slice(0, 40);
  return `recommendation_option_${digest}`;
}

function bounded(value: string, label: string, max = 8_000): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new Error(`${label} must contain between 1 and ${max} non-whitespace characters.`);
  }
  return normalized;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function dateOrThrow(value: string, label: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error(`${label} must be an ISO-compatible date.`);
  return date.toISOString();
}

function sameRecord(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function recommendationPremiseAuthority(
  basis: readonly RecommendationBasis[],
  userMaterialBasis: readonly string[],
  intentVersionId: string,
  sourceMessageId: string,
): RecommendationPremiseAuthority {
  const hasIntentVersion = userMaterialBasis.includes(intentVersionId);
  const hasSourceMessage = userMaterialBasis.includes(sourceMessageId);
  if (userMaterialBasis.length > 0 && (!hasIntentVersion || !hasSourceMessage)) {
    throw new Error("Recommendation USER-material basis must retain IntentVersion and source-message identity together.");
  }
  return Object.freeze({
    knowledge: basis.map((entry) => ({
      knowledgeId: entry.knowledgeId,
      claimIds: [...entry.claimIds],
    })),
    user: [{ intentVersionId, sourceMessageId }],
  });
}

function proposal(
  proposalId: string,
  text: string,
  origin: RecommendationProposal["origin"] = "SOLANDRA",
): RecommendationProposal {
  return Object.freeze({ proposalId, origin, factualAuthority: false, text });
}

function v2Proposals(
  recommendationId: string,
  recommendedProposal: string,
  alternativeProposals: readonly string[],
): RecommendationProposal[] {
  return [recommendedProposal, ...alternativeProposals].map((text, index) =>
    proposal(recommendationProposalId(recommendationId, index + 1), text));
}

function v1Proposals(
  recommendationId: string,
  recommendedProposal: string,
  alternativeProposals: readonly string[],
): RecommendationProposal[] {
  return [recommendedProposal, ...alternativeProposals].map((text, index) =>
    proposal(legacyRecommendationOptionId(recommendationId, index + 1, text), text));
}

function legacyPlaceholder(position: number): string {
  return position === 1
    ? "Earlier Recommendation text is unavailable under the current factual-trust boundary."
    : `Earlier option ${position} text is unavailable under the current factual-trust boundary.`;
}

function legacyProposals(
  recommendationId: string,
  recommendedText: string,
  alternatives: readonly string[],
): RecommendationProposal[] {
  return [recommendedText, ...alternatives].map((text, index) =>
    proposal(
      legacyRecommendationOptionId(recommendationId, index + 1, text),
      legacyPlaceholder(index + 1),
      "LEGACY_UNCLASSIFIED",
    ));
}

function assertProposalRelationship(record: Pick<
  RecommendationRecord,
  "proposals" | "recommendedProposalId" | "rankedProposalIds"
>): void {
  if (record.proposals.length === 0) throw new Error("Recommendation requires at least one advisory proposal.");
  const byId = new Map(record.proposals.map((item) => [item.proposalId, item]));
  if (byId.size !== record.proposals.length) throw new Error("Recommendation proposal identities must be unique.");
  if (
    record.rankedProposalIds.length !== record.proposals.length
    || new Set(record.rankedProposalIds).size !== record.rankedProposalIds.length
    || record.rankedProposalIds.some((proposalId) => !byId.has(proposalId))
  ) {
    throw new Error("Recommendation proposal ranking must resolve exactly to its durable proposal set.");
  }
  if (record.rankedProposalIds[0] !== record.recommendedProposalId || !byId.has(record.recommendedProposalId)) {
    throw new Error("Recommendation recommended proposal identity must be first in its durable ranking.");
  }
  if (record.proposals.some((item) => item.factualAuthority !== false)) {
    throw new Error("Recommendation proposal wording cannot carry factual authority.");
  }
}

function rankedProposals(record: RecommendationRecord): RecommendationProposal[] {
  assertProposalRelationship(record);
  const byId = new Map(record.proposals.map((item) => [item.proposalId, item]));
  return record.rankedProposalIds.map((proposalId) => byId.get(proposalId)!);
}

export function buildRecommendationRecord(input: {
  conversationId: string;
  runId: string | null;
  intentScopeId: string;
  intentVersionId: string;
  sourceMessageId: string;
  basis: RecommendationBasis[];
  userMaterialBasis?: string[];
  recommendedProposal: string;
  alternativeProposals: string[];
  rationale: string[];
  tradeoffs: string[];
  assumptions: string[];
  uncertainties: string[];
  createdAt: string;
}): RecommendationRecord {
  const conversationId = bounded(input.conversationId, "conversationId", 128);
  const runId = input.runId === null ? null : bounded(input.runId, "runId", 200);
  const intentScopeId = bounded(input.intentScopeId, "intentScopeId", 200);
  const intentVersionId = bounded(input.intentVersionId, "intentVersionId", 200);
  const sourceMessageId = bounded(input.sourceMessageId, "sourceMessageId", 200);
  const basis = input.basis.map((entry) => ({
    knowledgeId: bounded(entry.knowledgeId, "basis knowledgeId", 128),
    claimIds: unique(entry.claimIds),
  })).filter((entry) => entry.claimIds.length > 0);
  const userMaterialBasis = unique(input.userMaterialBasis ?? [])
    .map((item) => bounded(item, "user material basis", 200));
  if (basis.length === 0 && userMaterialBasis.length === 0) {
    throw new Error("Recommendation requires governed Knowledge basis or exact USER-material basis identity.");
  }
  const basisByKnowledge = new Map<string, Set<string>>();
  for (const entry of basis) {
    const claims = basisByKnowledge.get(entry.knowledgeId) ?? new Set<string>();
    for (const claimId of entry.claimIds) claims.add(bounded(claimId, "basis claimId", 200));
    basisByKnowledge.set(entry.knowledgeId, claims);
  }
  const normalizedBasis = [...basisByKnowledge.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([knowledgeId, claimIds]) => ({ knowledgeId, claimIds: [...claimIds].sort() }));
  const knowledgeIds = normalizedBasis.map((entry) => entry.knowledgeId);
  const claimIds = unique(normalizedBasis.flatMap((entry) => entry.claimIds));
  const premiseAuthority = recommendationPremiseAuthority(
    normalizedBasis,
    userMaterialBasis,
    intentVersionId,
    sourceMessageId,
  );
  const exactBasisIdentity = normalizedBasis.map((entry) => `${entry.knowledgeId}:${entry.claimIds.join(",")}`);
  const userIdentity = runId === null ? userMaterialBasis : [];
  const recommendationId = stableId(
    "recommendation",
    runId ?? sourceMessageId,
    intentVersionId,
    ...exactBasisIdentity,
    ...userIdentity,
  );
  const recommendedProposal = bounded(input.recommendedProposal, "recommended proposal");
  const alternativeProposals = input.alternativeProposals.map((item) => bounded(item, "alternative proposal", 2_000));
  const proposals = v2Proposals(recommendationId, recommendedProposal, alternativeProposals);
  const rankedProposalIds = proposals.map((item) => item.proposalId);
  const record: RecommendationRecord = {
    recommendationId,
    conversationId,
    runId,
    intentScopeId,
    intentVersionId,
    sourceMessageId,
    basis: normalizedBasis,
    userMaterialBasis,
    premiseAuthority,
    knowledgeIds,
    claimIds,
    representationKind: "STRUCTURAL_PROPOSAL_V2",
    proposals,
    recommendedProposalId: rankedProposalIds[0]!,
    rankedProposalIds,
    rationale: input.rationale.map((item) => bounded(item, "rationale item", 2_000)),
    tradeoffs: input.tradeoffs.map((item) => bounded(item, "tradeoff", 2_000)),
    assumptions: input.assumptions.map((item) => bounded(item, "assumption", 2_000)),
    uncertainties: input.uncertainties.map((item) => bounded(item, "uncertainty", 2_000)),
    selectionAuthorized: false,
    createdAt: dateOrThrow(input.createdAt, "createdAt"),
  };
  assertProposalRelationship(record);
  return Object.freeze(record);
}

export class MemoryRecommendationStore implements RecommendationStore {
  readonly kind = "memory" as const;
  private readonly records = new Map<string, RecommendationRecord>();
  private readonly byRun = new Map<string, string>();

  async putRecommendation(record: RecommendationRecord): Promise<RecommendationRecord> {
    assertProposalRelationship(record);
    const existing = this.records.get(record.recommendationId);
    if (existing) {
      if (!sameRecord(existing, record)) throw new Error("Recommendation identity cannot be rebound to different advisory state.");
      return clone(existing);
    }
    const runRecommendation = record.runId === null ? undefined : this.byRun.get(record.runId);
    if (runRecommendation && runRecommendation !== record.recommendationId) {
      throw new Error("A completed advisory Run cannot establish multiple Recommendation identities.");
    }
    this.records.set(record.recommendationId, clone(record));
    if (record.runId !== null) this.byRun.set(record.runId, record.recommendationId);
    return clone(record);
  }

  async getRecommendation(recommendationId: string): Promise<RecommendationRecord | undefined> {
    const value = this.records.get(recommendationId);
    return value ? clone(value) : undefined;
  }

  async getRecommendationByRunId(runId: string): Promise<RecommendationRecord | undefined> {
    const id = this.byRun.get(runId);
    return id ? await this.getRecommendation(id) : undefined;
  }

  async listRecommendationsByConversation(conversationId: string): Promise<RecommendationRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.conversationId === conversationId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.recommendationId.localeCompare(right.recommendationId))
      .map(clone);
  }

  async close(): Promise<void> {
    this.records.clear();
    this.byRun.clear();
  }
}

type RecommendationRow = {
  recommendation_id: string;
  conversation_id: string;
  run_id: string | null;
  intent_scope_id: string;
  intent_version_id: string;
  source_message_id: string;
  basis: unknown;
  user_material_basis: unknown;
  knowledge_ids: unknown;
  claim_ids: unknown;
  representation_kind: string;
  recommendation: string;
  rationale: unknown;
  tradeoffs: unknown;
  assumptions: unknown;
  uncertainties: unknown;
  alternatives: unknown;
  selection_authorized: boolean;
  created_at: Date | string;
};

function recommendationBasis(value: unknown): RecommendationBasis[] {
  if (!Array.isArray(value)) throw new Error("Persisted Recommendation basis is invalid.");
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Persisted Recommendation basis entry is invalid.");
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.knowledgeId !== "string") throw new Error("Persisted Recommendation basis knowledgeId is invalid.");
    return {
      knowledgeId: record.knowledgeId,
      claimIds: stringArray(record.claimIds, "basis claimIds"),
    };
  });
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`Persisted ${label} is invalid.`);
  }
  return [...value];
}

function representationKind(value: string): RecommendationRepresentationKind {
  if (
    value === "LEGACY_FREEFORM"
    || value === "STRUCTURAL_ADVISORY_V1"
    || value === "STRUCTURAL_PROPOSAL_V2"
  ) return value;
  throw new Error("Persisted Recommendation representation kind is invalid.");
}

function mapRecommendation(row: RecommendationRow): RecommendationRecord {
  if (row.selection_authorized !== false) throw new Error("Persisted Recommendation cannot authorize selection.");
  const basis = recommendationBasis(row.basis);
  const userMaterialBasis = stringArray(row.user_material_basis, "user_material_basis");
  const kind = representationKind(row.representation_kind);
  const rawAlternatives = stringArray(row.alternatives, "alternatives");
  const proposals = kind === "LEGACY_FREEFORM"
    ? legacyProposals(row.recommendation_id, row.recommendation, rawAlternatives)
    : kind === "STRUCTURAL_ADVISORY_V1"
      ? v1Proposals(row.recommendation_id, row.recommendation, rawAlternatives)
      : v2Proposals(row.recommendation_id, row.recommendation, rawAlternatives);
  const rankedProposalIds = proposals.map((item) => item.proposalId);
  const legacy = kind === "LEGACY_FREEFORM";
  const record: RecommendationRecord = {
    recommendationId: row.recommendation_id,
    conversationId: row.conversation_id,
    runId: row.run_id,
    intentScopeId: row.intent_scope_id,
    intentVersionId: row.intent_version_id,
    sourceMessageId: row.source_message_id,
    basis,
    userMaterialBasis,
    premiseAuthority: recommendationPremiseAuthority(
      basis,
      userMaterialBasis,
      row.intent_version_id,
      row.source_message_id,
    ),
    knowledgeIds: stringArray(row.knowledge_ids, "knowledge_ids"),
    claimIds: stringArray(row.claim_ids, "claim_ids"),
    representationKind: kind,
    proposals,
    recommendedProposalId: rankedProposalIds[0]!,
    rankedProposalIds,
    rationale: legacy ? [] : stringArray(row.rationale, "rationale"),
    tradeoffs: legacy ? [] : stringArray(row.tradeoffs, "tradeoffs"),
    assumptions: legacy ? [] : stringArray(row.assumptions, "assumptions"),
    uncertainties: legacy ? [] : stringArray(row.uncertainties, "uncertainties"),
    selectionAuthorized: false,
    createdAt: dateOrThrow(row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at, "created_at"),
  };
  assertProposalRelationship(record);
  return record;
}

async function applyMigration(pool: Pool, migration: typeof migrations[number]): Promise<void> {
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
  const result = await pool.query<{ name: string }>(
    "SELECT name FROM schema_migrations WHERE name = ANY($1::text[])",
    [migrations],
  );
  const applied = new Set(result.rows.map((row) => row.name));
  const missing = migrations.filter((migration) => !applied.has(migration));
  if (missing.length > 0) {
    throw new Error(`Recommendation schema is not ready; required migration ${missing.join(", ")} is missing.`);
  }
}

const columns = "recommendation_id,conversation_id,run_id,intent_scope_id,intent_version_id,source_message_id,basis,user_material_basis,knowledge_ids,claim_ids,representation_kind,recommendation,rationale,tradeoffs,assumptions,uncertainties,alternatives,selection_authorized,created_at";

export class PostgresRecommendationStore implements RecommendationStore {
  readonly kind = "postgres" as const;
  private constructor(private readonly pool: Pool) {}

  static async migrate(databaseUrl: string): Promise<void> {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query("SELECT 1");
      for (const migration of migrations) await applyMigration(pool, migration);
      await assertReady(pool);
    } finally {
      await pool.end();
    }
  }

  static async connect(databaseUrl: string): Promise<PostgresRecommendationStore> {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query("SELECT 1");
      await assertReady(pool);
      return new PostgresRecommendationStore(pool);
    } catch (error) {
      await pool.end();
      throw error;
    }
  }

  async putRecommendation(record: RecommendationRecord): Promise<RecommendationRecord> {
    assertProposalRelationship(record);
    if (record.representationKind !== "STRUCTURAL_PROPOSAL_V2") {
      throw new Error("Only STRUCTURAL_PROPOSAL_V2 Recommendation records may be newly persisted.");
    }
    const ranked = rankedProposals(record);
    const recommended = ranked[0]!;
    const alternatives = ranked.slice(1).map((item) => item.text);
    const result = await this.pool.query<RecommendationRow>(
      `INSERT INTO recommendations(${columns})
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb,$16::jsonb,$17::jsonb,$18,$19)
       ON CONFLICT(recommendation_id) DO NOTHING
       RETURNING ${columns}`,
      [
        record.recommendationId,
        record.conversationId,
        record.runId,
        record.intentScopeId,
        record.intentVersionId,
        record.sourceMessageId,
        JSON.stringify(record.basis),
        JSON.stringify(record.userMaterialBasis),
        JSON.stringify(record.knowledgeIds),
        JSON.stringify(record.claimIds),
        record.representationKind,
        recommended.text,
        JSON.stringify(record.rationale),
        JSON.stringify(record.tradeoffs),
        JSON.stringify(record.assumptions),
        JSON.stringify(record.uncertainties),
        JSON.stringify(alternatives),
        false,
        record.createdAt,
      ],
    );
    if ((result.rowCount ?? 0) > 0) return mapRecommendation(result.rows[0]!);
    const existing = await this.getRecommendation(record.recommendationId);
    if (!existing) throw new Error("Recommendation insert lost its persisted identity.");
    if (!sameRecord(existing, record)) throw new Error("Recommendation identity cannot be rebound to different advisory state.");
    return existing;
  }

  async getRecommendation(recommendationId: string): Promise<RecommendationRecord | undefined> {
    const result = await this.pool.query<RecommendationRow>(`SELECT ${columns} FROM recommendations WHERE recommendation_id=$1`, [recommendationId]);
    return result.rows[0] ? mapRecommendation(result.rows[0]) : undefined;
  }

  async getRecommendationByRunId(runId: string): Promise<RecommendationRecord | undefined> {
    const result = await this.pool.query<RecommendationRow>(`SELECT ${columns} FROM recommendations WHERE run_id=$1`, [runId]);
    return result.rows[0] ? mapRecommendation(result.rows[0]) : undefined;
  }

  async listRecommendationsByConversation(conversationId: string): Promise<RecommendationRecord[]> {
    const result = await this.pool.query<RecommendationRow>(
      `SELECT ${columns} FROM recommendations WHERE conversation_id=$1 ORDER BY created_at,recommendation_id`,
      [conversationId],
    );
    return result.rows.map(mapRecommendation);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
