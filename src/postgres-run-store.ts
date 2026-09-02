import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";
import type {
  LatticeRun,
  RunEvent,
  RunEventType,
  RunRequest,
  RunStatus,
  StructuredDecision,
} from "./domain.js";
import {
  assertAllowedTransition,
  type RunCompletion,
  type RunDecisionPersistence,
  type RunStore,
  type RunTransition,
  type RunTransitionResult,
} from "./run-store.js";
import {
  assertTruthSnapshotIntegrity,
  assertTruthSnapshotTransition,
  type TruthSnapshot,
  type TruthSnapshotPhase,
} from "./truth/snapshot.js";
import { assertTruthBundleIntegrity } from "./truth/invariants.js";
import type {
  ClaimEvidence,
  CompiledClaim,
  ProofCheck,
  ProvenanceComponent,
  ResearchQuestion,
  SourceArtifact,
  SourceEdge,
  TruthAssessment,
  TruthBundle,
} from "./truth/types.js";

const migrationFiles = [
  "005_runs.sql",
  "006_run_events.sql",
  "007_dispatch_outbox.sql",
  "008_truth_sources.sql",
  "009_truth_claims.sql",
  "010_truth_evidence_graph.sql",
  "011_truth_proof_checks.sql",
  "012_truth_assessments.sql",
  "013_run_deferred_outputs.sql",
  "014_v36_architecture_reconciliation.sql",
  "015_truth_claim_context.sql",
  "016_truth_snapshot_state.sql",
] as const;

async function applyMigrations(pool: Pool): Promise<void> {
  await pool.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  for (const name of migrationFiles) {
    const existing = await pool.query<{ name: string }>(
      "SELECT name FROM schema_migrations WHERE name = $1",
      [name],
    );
    if ((existing.rowCount ?? 0) > 0) continue;
    const sql = await readFile(resolve(process.cwd(), "migrations", name), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [name]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

async function assertSchemaReady(pool: Pool): Promise<void> {
  const registry = await pool.query<{ schema_migrations: string | null }>(
    "SELECT to_regclass('public.schema_migrations')::text AS schema_migrations",
  );
  if (!registry.rows[0]?.schema_migrations) {
    throw new Error("Database schema is not initialized; run the authorized migration command before durable startup.");
  }
  const latest = migrationFiles[migrationFiles.length - 1];
  const result = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM schema_migrations WHERE name = $1",
    [latest],
  );
  if (result.rows[0]?.count !== "1") {
    throw new Error(`Database schema is not ready; required migration ${latest} is missing.`);
  }
}

type RunRow = {
  id: string;
  conversation_id: string;
  status: RunStatus;
  version: string | number;
  request_json: RunRequest;
  decision_json: StructuredDecision | null;
  explanation: string | null;
};

type EventRow = { sequence: string | number; event_type: RunEventType };
type SnapshotMetadataRow = {
  phase: TruthSnapshotPhase;
  execution_contract_id: string;
  bundle_hash: string;
  updated_at: Date | string;
};

async function insertEvents(client: PoolClient, run: LatticeRun): Promise<void> {
  for (const event of run.events) {
    await client.query(
      "INSERT INTO run_events(run_id, sequence, event_type) VALUES ($1, $2, $3)",
      [run.id, event.sequence, event.type],
    );
  }
}

async function nextEventSequence(client: PoolClient, runId: string): Promise<number> {
  const result = await client.query<{ sequence: string | number }>(
    "SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM run_events WHERE run_id = $1",
    [runId],
  );
  return Number(result.rows[0]?.sequence ?? 1);
}

async function insertTruthBundle(client: PoolClient, bundle: TruthBundle): Promise<void> {
  assertTruthBundleIntegrity(bundle);
  for (const component of bundle.provenanceComponents) {
    await client.query(
      "INSERT INTO truth_provenance_components(run_id, component_key, canonical_origin_key, confidence) VALUES ($1,$2,$3,$4)",
      [component.runId, component.key, component.canonicalOriginKey, component.confidence],
    );
  }
  for (const source of bundle.sources) {
    await client.query(
      `INSERT INTO truth_source_artifacts(
        run_id,id,canonical_uri,artifact_hash,publisher,origin_key,content_type,retrieved_at,
        published_at,effective_from,effective_to,metadata_json,provenance_component_key,
        provenance_confidence,authoritative_primary
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15)`,
      [
        source.runId, source.id, source.canonicalUri, source.artifactHash, source.publisher,
        source.originKey, source.contentType, source.retrievedAt, source.publishedAt,
        source.effectiveFrom, source.effectiveTo, JSON.stringify(source.metadata),
        source.provenanceComponentKey, source.provenanceConfidence, source.authoritativePrimary,
      ],
    );
  }
  for (const claim of bundle.claims) {
    await client.query(
      `INSERT INTO truth_claims(
        run_id,id,claim_text,claim_type,scope_text,effective_at,jurisdiction_text,unit_text,
        denominator_text,baseline_text,qualifiers_json,period_text,causal_relation_text,
        authenticity_target_text,comparison_class_text,quoted_context_text,evidence_risk
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17)`,
      [
        claim.runId, claim.id, claim.text, claim.claimType, claim.scope, claim.effectiveAt,
        claim.jurisdiction, claim.unit, claim.denominator, claim.baseline,
        JSON.stringify(claim.qualifiers), claim.period, claim.causalRelation,
        claim.authenticityTarget, claim.comparisonClass, claim.quotedContext, claim.evidenceRisk,
      ],
    );
  }
  for (const question of [...bundle.researchQuestions].sort((a, b) => a.serialRound - b.serialRound)) {
    await client.query(
      "INSERT INTO truth_research_questions(run_id,id,claim_id,parent_question_id,purpose,query_text,serial_round) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [
        question.runId, question.id, question.claimId, question.parentQuestionId,
        question.purpose, question.query, question.serialRound,
      ],
    );
  }
  for (const edge of bundle.sourceEdges) {
    await client.query(
      "INSERT INTO truth_source_edges(run_id,id,from_artifact_id,to_artifact_id,edge_type,confidence,content_similarity) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [
        edge.runId, edge.id, edge.fromArtifactId, edge.toArtifactId,
        edge.edgeType, edge.confidence, edge.contentSimilarity,
      ],
    );
  }
  for (const evidence of bundle.claimEvidence) {
    await client.query(
      `INSERT INTO truth_claim_evidence(
        run_id,id,claim_id,artifact_id,external_evidence_id,relation,specific_evidence,
        provenance_component_key,admitted,rejection_reason,provenance_confidence,
        authoritative_primary,research_question_id,verification
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        evidence.runId, evidence.id, evidence.claimId, evidence.artifactId,
        evidence.externalEvidenceId, evidence.relation, evidence.specificEvidence,
        evidence.provenanceComponentKey, evidence.admitted, evidence.rejectionReason,
        evidence.provenanceConfidence, evidence.authoritativePrimary,
        evidence.researchQuestionId, evidence.verification,
      ],
    );
  }
  for (const obligation of bundle.obligations) {
    await client.query(
      "INSERT INTO truth_proof_obligations(run_id,id,claim_id,kind,required) VALUES ($1,$2,$3,$4,$5)",
      [obligation.runId, obligation.id, obligation.claimId, obligation.kind, obligation.required],
    );
  }
  for (const check of bundle.checks) {
    await client.query(
      "INSERT INTO truth_proof_checks(run_id,id,obligation_id,status,evidence_ids_json,explanation) VALUES ($1,$2,$3,$4,$5::jsonb,$6)",
      [
        check.runId, check.id, check.obligationId, check.status,
        JSON.stringify(check.evidenceIds), check.explanation,
      ],
    );
  }
  for (const assessment of bundle.assessments) {
    await client.query(
      `INSERT INTO truth_assessments(
        run_id,id,claim_id,verdict,confidence,admitted_evidence_ids_json,
        contradictory_evidence_ids_json,unresolved_obligation_ids_json,rationale_json,
        atomic_disposition
      ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10)`,
      [
        assessment.runId, assessment.id, assessment.claimId, assessment.verdict,
        assessment.confidence, JSON.stringify(assessment.admittedEvidenceIds),
        JSON.stringify(assessment.contradictoryEvidenceIds),
        JSON.stringify(assessment.unresolvedObligationIds), JSON.stringify(assessment.rationale),
        assessment.atomicDisposition,
      ],
    );
  }
}

async function deleteTruthBundle(client: PoolClient, runId: string): Promise<void> {
  await client.query("DELETE FROM truth_claim_evidence WHERE run_id=$1", [runId]);
  await client.query("DELETE FROM truth_source_edges WHERE run_id=$1", [runId]);
  await client.query("DELETE FROM truth_proof_checks WHERE run_id=$1", [runId]);
  await client.query("DELETE FROM truth_assessments WHERE run_id=$1", [runId]);
  await client.query("DELETE FROM truth_research_questions WHERE run_id=$1", [runId]);
  await client.query("DELETE FROM truth_proof_obligations WHERE run_id=$1", [runId]);
  await client.query("DELETE FROM truth_claims WHERE run_id=$1", [runId]);
  await client.query("DELETE FROM truth_source_artifacts WHERE run_id=$1", [runId]);
  await client.query("DELETE FROM truth_provenance_components WHERE run_id=$1", [runId]);
}

async function replaceTruthSnapshot(client: PoolClient, snapshot: TruthSnapshot): Promise<void> {
  assertTruthSnapshotIntegrity(snapshot);
  await deleteTruthBundle(client, snapshot.runId);
  await insertTruthBundle(client, snapshot.bundle);
  await client.query(
    `INSERT INTO truth_snapshot_state(run_id,phase,execution_contract_id,bundle_hash,updated_at)
     VALUES ($1,$2,$3,$4,now())
     ON CONFLICT (run_id) DO UPDATE SET
       phase=EXCLUDED.phase,
       execution_contract_id=EXCLUDED.execution_contract_id,
       bundle_hash=EXCLUDED.bundle_hash,
       updated_at=now()`,
    [snapshot.runId, snapshot.phase, snapshot.executionContractId, snapshot.bundleHash],
  );
}

export interface PostgresConnectOptions { migrate?: boolean }

export class PostgresRunStore implements RunStore {
  readonly kind = "postgres" as const;

  private constructor(private readonly pool: Pool) {}

  static async migrate(connectionString: string): Promise<void> {
    const pool = new Pool({ connectionString });
    try {
      await pool.query("SELECT 1");
      await applyMigrations(pool);
      await assertSchemaReady(pool);
    } finally {
      await pool.end();
    }
  }

  static async connect(
    connectionString: string,
    options: PostgresConnectOptions = {},
  ): Promise<PostgresRunStore> {
    const pool = new Pool({ connectionString });
    try {
      await pool.query("SELECT 1");
      if (options.migrate ?? true) await applyMigrations(pool);
      await assertSchemaReady(pool);
      return new PostgresRunStore(pool);
    } catch (error) {
      await pool.end();
      throw error;
    }
  }

  async create(run: LatticeRun): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO runs(id,conversation_id,status,version,request_json,decision_json,explanation) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)",
        [
          run.id, run.conversationId, run.status, run.version, JSON.stringify(run.request),
          run.decision === null ? null : JSON.stringify(run.decision), run.explanation,
        ],
      );
      await insertEvents(client, run);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async transition(input: RunTransition): Promise<RunTransitionResult> {
    assertAllowedTransition(input.expectedStatus, input.nextStatus);
    if (input.truthSnapshot) {
      if (input.truthSnapshot.runId !== input.runId) {
        throw new Error("Truth snapshot Run scope does not match transition Run.");
      }
      assertTruthSnapshotTransition(input.expectedStatus, input.nextStatus, input.truthSnapshot);
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query<{ version: string | number }>(
        "UPDATE runs SET status=$1, version=version+1, updated_at=now() WHERE id=$2 AND status=$3 AND version=$4 RETURNING version",
        [input.nextStatus, input.runId, input.expectedStatus, input.expectedVersion],
      );
      const row = updated.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return { outcome: "stale" };
      }
      const sequence = await nextEventSequence(client, input.runId);
      await client.query(
        "INSERT INTO run_events(run_id,sequence,event_type) VALUES ($1,$2,$3)",
        [input.runId, sequence, input.nextStatus],
      );
      if (input.truthSnapshot) await replaceTruthSnapshot(client, input.truthSnapshot);
      if (input.dispatch) {
        await client.query(
          "INSERT INTO dispatch_outbox(logical_key,run_id,queue_name,payload,available_at) VALUES ($1,$2,$3,$4::jsonb,COALESCE($5,now()))",
          [
            input.dispatch.logicalKey, input.runId, input.dispatch.queueName,
            JSON.stringify(input.dispatch.payload), input.dispatch.availableAt ?? null,
          ],
        );
      }
      await client.query("COMMIT");
      return { outcome: "advanced", version: Number(row.version) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async persistDecision(input: RunDecisionPersistence): Promise<RunTransitionResult> {
    const updated = await this.pool.query<{ version: string | number }>(
      "UPDATE runs SET decision_json=$1::jsonb, version=version+1, updated_at=now() WHERE id=$2 AND status='DECIDING' AND version=$3 AND decision_json IS NULL RETURNING version",
      [JSON.stringify(input.decision), input.runId, input.expectedVersion],
    );
    const row = updated.rows[0];
    return row ? { outcome: "advanced", version: Number(row.version) } : { outcome: "stale" };
  }

  async complete(input: RunCompletion): Promise<RunTransitionResult> {
    assertAllowedTransition("DECIDING", "COMPLETED");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query<{ version: string | number }>(
        "UPDATE runs SET status='COMPLETED', version=version+1, explanation=$1, updated_at=now() WHERE id=$2 AND status='DECIDING' AND version=$3 AND decision_json IS NOT NULL RETURNING version",
        [input.explanation, input.runId, input.expectedVersion],
      );
      const row = updated.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return { outcome: "stale" };
      }
      const sequence = await nextEventSequence(client, input.runId);
      await client.query(
        "INSERT INTO run_events(run_id,sequence,event_type) VALUES ($1,$2,'EXPLAINING'),($1,$3,'COMPLETED')",
        [input.runId, sequence, sequence + 1],
      );
      await client.query("COMMIT");
      return { outcome: "advanced", version: Number(row.version) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async get(runId: string): Promise<LatticeRun | undefined> {
    let result;
    try {
      result = await this.pool.query<RunRow>(
        "SELECT id,conversation_id,status,version,request_json,decision_json,explanation FROM runs WHERE id=$1",
        [runId],
      );
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "22P02") {
        return undefined;
      }
      throw error;
    }
    const row = result.rows[0];
    if (!row) return undefined;
    const eventRows = await this.pool.query<EventRow>(
      "SELECT sequence,event_type FROM run_events WHERE run_id=$1 ORDER BY sequence",
      [runId],
    );
    const assessmentRows = await this.pool.query<{ id: string }>(
      "SELECT id FROM truth_assessments WHERE run_id=$1 ORDER BY created_at,id",
      [runId],
    );
    const events: RunEvent[] = eventRows.rows.map((event) => ({
      sequence: Number(event.sequence),
      type: event.event_type,
    }));
    return {
      id: row.id,
      conversationId: row.conversation_id,
      status: row.status,
      version: Number(row.version),
      request: row.request_json,
      decision: row.decision_json,
      explanation: row.explanation,
      truthAssessmentIds: assessmentRows.rows.map((assessment) => assessment.id),
      events,
    };
  }

  private async readSnapshotMetadata(runId: string): Promise<SnapshotMetadataRow | undefined> {
    const result = await this.pool.query<SnapshotMetadataRow>(
      "SELECT phase,execution_contract_id,bundle_hash,updated_at FROM truth_snapshot_state WHERE run_id=$1",
      [runId],
    );
    return result.rows[0];
  }

  async getTruthSnapshot(runId: string): Promise<TruthSnapshot | undefined> {
    // READ COMMITTED queries can straddle a concurrent atomic replacement. The
    // before/after metadata check detects that race and retries rather than
    // returning a mixed-generation structured snapshot.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const before = await this.readSnapshotMetadata(runId);
      if (!before) return undefined;
      const bundle = await this.getTruthBundle(runId);
      if (!bundle) throw new Error("Truth snapshot metadata exists without structured V36 state.");
      const after = await this.readSnapshotMetadata(runId);
      if (!after) continue;
      const beforeStamp = new Date(before.updated_at).toISOString();
      const afterStamp = new Date(after.updated_at).toISOString();
      if (
        before.phase !== after.phase
        || before.execution_contract_id !== after.execution_contract_id
        || before.bundle_hash !== after.bundle_hash
        || beforeStamp !== afterStamp
      ) {
        continue;
      }
      const snapshot: TruthSnapshot = {
        runId,
        phase: after.phase,
        executionContractId: after.execution_contract_id,
        bundleHash: after.bundle_hash,
        bundle,
      };
      assertTruthSnapshotIntegrity(snapshot);
      return snapshot;
    }
    throw new Error("Truth snapshot changed while it was being reconstructed; retry the read.");
  }

  async getTruthBundle(runId: string): Promise<TruthBundle | undefined> {
    if (!await this.readSnapshotMetadata(runId)) return undefined;
    const claimRows = await this.pool.query<{
      id: string;
      claim_text: string;
      claim_type: CompiledClaim["claimType"];
      scope_text: string | null;
      effective_at: Date | string | null;
      jurisdiction_text: string | null;
      unit_text: string | null;
      denominator_text: string | null;
      baseline_text: string | null;
      qualifiers_json: CompiledClaim["qualifiers"];
      period_text: string | null;
      causal_relation_text: string | null;
      authenticity_target_text: string | null;
      comparison_class_text: string | null;
      quoted_context_text: string | null;
      evidence_risk: CompiledClaim["evidenceRisk"];
    }>(
      "SELECT id,claim_text,claim_type,scope_text,effective_at,jurisdiction_text,unit_text,denominator_text,baseline_text,qualifiers_json,period_text,causal_relation_text,authenticity_target_text,comparison_class_text,quoted_context_text,evidence_risk FROM truth_claims WHERE run_id=$1 ORDER BY created_at,id",
      [runId],
    );

    const [
      componentRows,
      sourceRows,
      edgeRows,
      researchRows,
      evidenceRows,
      obligationRows,
      checkRows,
      assessmentRows,
    ] = await Promise.all([
      this.pool.query<{
        component_key: string;
        canonical_origin_key: string;
        confidence: ProvenanceComponent["confidence"];
      }>(
        "SELECT component_key,canonical_origin_key,confidence FROM truth_provenance_components WHERE run_id=$1 ORDER BY component_key",
        [runId],
      ),
      this.pool.query<{
        id: string;
        canonical_uri: string;
        artifact_hash: string;
        publisher: string | null;
        origin_key: string | null;
        provenance_component_key: string | null;
        provenance_confidence: SourceArtifact["provenanceConfidence"];
        authoritative_primary: boolean;
        retrieved_at: Date | string;
        published_at: Date | string | null;
        effective_from: Date | string | null;
        effective_to: Date | string | null;
        content_type: string;
        metadata_json: Record<string, unknown>;
      }>(
        "SELECT id,canonical_uri,artifact_hash,publisher,origin_key,provenance_component_key,provenance_confidence,authoritative_primary,retrieved_at,published_at,effective_from,effective_to,content_type,metadata_json FROM truth_source_artifacts WHERE run_id=$1 ORDER BY id",
        [runId],
      ),
      this.pool.query<{
        id: string;
        from_artifact_id: string;
        to_artifact_id: string;
        edge_type: SourceEdge["edgeType"];
        confidence: number;
        content_similarity: number | null;
      }>(
        "SELECT id,from_artifact_id,to_artifact_id,edge_type,confidence,content_similarity FROM truth_source_edges WHERE run_id=$1 ORDER BY id",
        [runId],
      ),
      this.pool.query<{
        id: string;
        claim_id: string;
        parent_question_id: string | null;
        purpose: ResearchQuestion["purpose"];
        query_text: string;
        serial_round: number;
      }>(
        "SELECT id,claim_id,parent_question_id,purpose,query_text,serial_round FROM truth_research_questions WHERE run_id=$1 ORDER BY serial_round,id",
        [runId],
      ),
      this.pool.query<{
        id: string;
        claim_id: string;
        artifact_id: string;
        external_evidence_id: string;
        relation: ClaimEvidence["relation"];
        specific_evidence: string;
        provenance_component_key: string | null;
        provenance_confidence: ClaimEvidence["provenanceConfidence"];
        authoritative_primary: boolean;
        research_question_id: string | null;
        verification: ClaimEvidence["verification"];
        admitted: boolean;
        rejection_reason: string | null;
      }>(
        "SELECT id,claim_id,artifact_id,external_evidence_id,relation,specific_evidence,provenance_component_key,provenance_confidence,authoritative_primary,research_question_id,verification,admitted,rejection_reason FROM truth_claim_evidence WHERE run_id=$1 ORDER BY id",
        [runId],
      ),
      this.pool.query<{ id: string; claim_id: string; kind: string; required: boolean }>(
        "SELECT id,claim_id,kind,required FROM truth_proof_obligations WHERE run_id=$1 ORDER BY id",
        [runId],
      ),
      this.pool.query<{
        id: string;
        obligation_id: string;
        status: ProofCheck["status"];
        evidence_ids_json: string[];
        explanation: string | null;
      }>(
        "SELECT id,obligation_id,status,evidence_ids_json,explanation FROM truth_proof_checks WHERE run_id=$1 ORDER BY id",
        [runId],
      ),
      this.pool.query<{
        id: string;
        claim_id: string;
        atomic_disposition: TruthAssessment["atomicDisposition"];
        verdict: TruthAssessment["verdict"];
        confidence: TruthAssessment["confidence"];
        admitted_evidence_ids_json: string[];
        contradictory_evidence_ids_json: string[];
        unresolved_obligation_ids_json: string[];
        rationale_json: string[];
      }>(
        "SELECT id,claim_id,atomic_disposition,verdict,confidence,admitted_evidence_ids_json,contradictory_evidence_ids_json,unresolved_obligation_ids_json,rationale_json FROM truth_assessments WHERE run_id=$1 ORDER BY created_at,id",
        [runId],
      ),
    ]);

    const iso = (value: Date | string | null): string | null =>
      value === null ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString();

    const bundle: TruthBundle = {
      runId,
      provenanceComponents: componentRows.rows.map((row) => ({
        runId,
        key: row.component_key,
        canonicalOriginKey: row.canonical_origin_key,
        confidence: row.confidence,
      })),
      researchQuestions: researchRows.rows.map((row) => ({
        id: row.id,
        runId,
        claimId: row.claim_id,
        parentQuestionId: row.parent_question_id,
        purpose: row.purpose,
        query: row.query_text,
        serialRound: Number(row.serial_round),
      })),
      sources: sourceRows.rows.map((row) => ({
        id: row.id,
        runId,
        canonicalUri: row.canonical_uri,
        artifactHash: row.artifact_hash,
        publisher: row.publisher,
        originKey: row.origin_key,
        provenanceComponentKey: row.provenance_component_key,
        provenanceConfidence: row.provenance_confidence,
        authoritativePrimary: row.authoritative_primary,
        retrievedAt: iso(row.retrieved_at) ?? "",
        publishedAt: iso(row.published_at),
        effectiveFrom: iso(row.effective_from),
        effectiveTo: iso(row.effective_to),
        contentType: row.content_type,
        metadata: row.metadata_json,
        untrusted: true,
      })),
      sourceEdges: edgeRows.rows.map((row) => ({
        id: row.id,
        runId,
        fromArtifactId: row.from_artifact_id,
        toArtifactId: row.to_artifact_id,
        edgeType: row.edge_type,
        confidence: row.confidence,
        contentSimilarity: row.content_similarity,
      })),
      claims: claimRows.rows.map((row) => ({
        id: row.id,
        runId,
        text: row.claim_text,
        claimType: row.claim_type,
        scope: row.scope_text,
        effectiveAt: iso(row.effective_at),
        jurisdiction: row.jurisdiction_text,
        unit: row.unit_text,
        denominator: row.denominator_text,
        baseline: row.baseline_text,
        period: row.period_text,
        causalRelation: row.causal_relation_text,
        authenticityTarget: row.authenticity_target_text,
        comparisonClass: row.comparison_class_text,
        quotedContext: row.quoted_context_text,
        qualifiers: row.qualifiers_json,
        evidenceRisk: row.evidence_risk,
      })),
      claimEvidence: evidenceRows.rows.map((row) => ({
        id: row.id,
        runId,
        claimId: row.claim_id,
        artifactId: row.artifact_id,
        externalEvidenceId: row.external_evidence_id,
        relation: row.relation,
        specificEvidence: row.specific_evidence,
        provenanceComponentKey: row.provenance_component_key,
        provenanceConfidence: row.provenance_confidence,
        authoritativePrimary: row.authoritative_primary,
        researchQuestionId: row.research_question_id,
        verification: row.verification,
        admitted: row.admitted,
        rejectionReason: row.rejection_reason,
      })),
      obligations: obligationRows.rows.map((row) => ({
        id: row.id,
        runId,
        claimId: row.claim_id,
        kind: row.kind,
        required: row.required,
      })),
      checks: checkRows.rows.map((row) => ({
        id: row.id,
        runId,
        obligationId: row.obligation_id,
        kind: "",
        status: row.status,
        evidenceIds: row.evidence_ids_json,
        explanation: row.explanation,
      })),
      assessments: assessmentRows.rows.map((row) => ({
        id: row.id,
        runId,
        claimId: row.claim_id,
        atomicDisposition: row.atomic_disposition,
        verdict: row.verdict,
        confidence: row.confidence,
        admittedEvidenceIds: row.admitted_evidence_ids_json,
        contradictoryEvidenceIds: row.contradictory_evidence_ids_json,
        unresolvedObligationIds: row.unresolved_obligation_ids_json,
        rationale: row.rationale_json,
      })),
    };
    const kinds = new Map(bundle.obligations.map((obligation) => [obligation.id, obligation.kind]));
    bundle.checks = bundle.checks.map((check) => ({
      ...check,
      kind: kinds.get(check.obligationId) ?? "UNKNOWN",
    }));
    assertTruthBundleIntegrity(bundle);
    return bundle;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
