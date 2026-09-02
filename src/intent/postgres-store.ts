import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";
import {
  applyIntentOperations,
  buildIntentResetOperations,
  buildIntentRevertOperations,
  correctionCommandFingerprint,
  initialIntentState,
  intentOperationPathKeys,
  intentStateChangedPathKeys,
  intentStatesAgreeOnPathKeys,
  intentStatesSemanticallyEqual,
  pendingIntentProposalDigest,
  resetCommandFingerprint,
  revertCommandFingerprint,
  transitionCommandFingerprint,
} from "./reducer.js";
import {
  intentPreferenceReuseCommandSchema,
  preferenceReuseAsTransition,
  preferenceReuseFingerprint,
  type IntentPreferenceReuseCommand,
} from "./preference-reuse-command.js";
import type { IntentAuthorityStore } from "./store.js";
import {
  confirmPendingIntentProposalSchema,
  createPendingIntentProposalSchema,
  emptyIntentState,
  intentCorrectionCommandSchema,
  intentOperationSchema,
  intentResetCommandSchema,
  intentRevertCommandSchema,
  intentStateSchema,
  intentTransitionCommandSchema,
  intentVersionLineageKindSchema,
  type ConfirmPendingIntentProposalCommand,
  type CreateIntentScopeInput,
  type CreatePendingIntentProposalInput,
  type IntentCorrectionCommand,
  type IntentOperation,
  type IntentProvenance,
  type IntentResetCommand,
  type IntentRevertCommand,
  type IntentScope,
  type IntentState,
  type IntentTransitionCommand,
  type IntentTransitionDisposition,
  type IntentTransitionResult,
  type IntentVersion,
  type IntentVersionLineageKind,
  type PendingIntentProposal,
  type PendingIntentProposalStatus,
} from "./types.js";

const migrationNames = [
  "022_intent_authority_core.sql",
  "023_intent_pending_clarifications.sql",
  "024_intent_version_lineage.sql",
] as const;

export interface PostgresIntentAuthorityOptions {
  migrate?: boolean;
  idFactory?: () => string;
}

type TransitionWrite = {
  transitionId: string;
  intentScopeId: string;
  baseIntentVersionId: string | null;
  logicalUserTurnId: string;
  observedMessageHorizon: number;
  sourceMessageId: string;
  sourceDigest: string;
  operations: IntentOperation[];
};

type TransitionRow = {
  transition_id: string;
  intent_scope_id: string;
  logical_user_turn_id: string;
  command_fingerprint: string;
  lineage_kind: IntentVersionLineageKind;
  lineage_target_intent_version_id: string | null;
  disposition: Exclude<IntentTransitionDisposition, "REPLAYED">;
  resulting_intent_version_id: string | null;
  version_number: string | number | null;
};

type ScopeRow = {
  intent_scope_id: string;
  scope_kind: "decision";
  lifecycle: "active";
  current_intent_version_id: string | null;
  next_version_number: string | number;
  observed_user_horizon: string | number;
  created_at: Date | string;
};

type VersionRow = {
  intent_scope_id: string;
  intent_version_id: string;
  version_number: string | number;
  predecessor_intent_version_id: string | null;
  transition_id: string;
  lineage_kind: IntentVersionLineageKind;
  lineage_target_intent_version_id: string | null;
  state_json: unknown;
  created_at: Date | string;
};

type PendingProposalRow = {
  proposal_id: string;
  proposal_digest: string;
  intent_scope_id: string;
  base_intent_version_id: string;
  observed_message_horizon: string | number;
  source_message_id: string;
  source_digest: string;
  operations_json: unknown;
  provenance_kind: "INFERRED_MATERIAL";
  materiality: "MATERIAL";
  status: PendingIntentProposalStatus;
  confirmed_transition_id: string | null;
  created_at: Date | string;
  resolved_at: Date | string | null;
};

type TargetContext = {
  target: VersionRow;
  beforeTargetState: IntentState;
  targetState: IntentState;
  successors: VersionRow[];
};

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function invalidResult(): IntentTransitionResult {
  return { disposition: "REJECTED_INVALID", resultingIntentVersionId: null, versionNumber: null };
}

function replayResult(row: TransitionRow): IntentTransitionResult {
  return {
    disposition: "REPLAYED",
    replayedDisposition: row.disposition,
    resultingIntentVersionId: row.resulting_intent_version_id,
    versionNumber: row.version_number === null ? null : Number(row.version_number),
  };
}

function transitionWrite(command: IntentTransitionCommand): TransitionWrite {
  return {
    transitionId: command.transitionId,
    intentScopeId: command.intentScopeId,
    baseIntentVersionId: command.baseIntentVersionId,
    logicalUserTurnId: command.logicalUserTurnId,
    observedMessageHorizon: command.observedMessageHorizon,
    sourceMessageId: command.sourceMessageId,
    sourceDigest: command.sourceDigest,
    operations: structuredClone(command.operations),
  };
}

function correctionWrite(command: IntentCorrectionCommand): TransitionWrite {
  return {
    transitionId: command.transitionId,
    intentScopeId: command.intentScopeId,
    baseIntentVersionId: command.baseIntentVersionId,
    logicalUserTurnId: command.logicalUserTurnId,
    observedMessageHorizon: command.observedMessageHorizon,
    sourceMessageId: command.sourceMessageId,
    sourceDigest: command.sourceDigest,
    operations: structuredClone(command.operations),
  };
}

function lineageWrite(
  command: IntentRevertCommand | IntentResetCommand,
  operations: IntentOperation[] = [],
): TransitionWrite {
  return {
    transitionId: command.transitionId,
    intentScopeId: command.intentScopeId,
    baseIntentVersionId: command.baseIntentVersionId,
    logicalUserTurnId: command.logicalUserTurnId,
    observedMessageHorizon: command.observedMessageHorizon,
    sourceMessageId: command.sourceMessageId,
    sourceDigest: command.sourceDigest,
    operations: structuredClone(operations),
  };
}

function writeAsTransitionCommand(write: TransitionWrite): IntentTransitionCommand {
  return intentTransitionCommandSchema.parse(write);
}

async function insertTransition(
  client: PoolClient,
  command: TransitionWrite,
  fingerprint: string,
  disposition: Exclude<IntentTransitionDisposition, "REPLAYED">,
  resultingIntentVersionId: string | null,
  versionNumber: number | null,
  lineageKind: IntentVersionLineageKind,
  lineageTargetIntentVersionId: string | null,
): Promise<void> {
  await client.query(
    `INSERT INTO intent_transitions(
       transition_id,intent_scope_id,base_intent_version_id,logical_user_turn_id,
       observed_message_horizon,source_message_id,source_digest,operations_json,
       command_fingerprint,disposition,resulting_intent_version_id,version_number,
       lineage_kind,lineage_target_intent_version_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14)`,
    [
      command.transitionId, command.intentScopeId, command.baseIntentVersionId,
      command.logicalUserTurnId, command.observedMessageHorizon, command.sourceMessageId,
      command.sourceDigest, JSON.stringify(command.operations), fingerprint, disposition,
      resultingIntentVersionId, versionNumber, lineageKind, lineageTargetIntentVersionId,
    ],
  );
}

async function advanceObservedUserHorizon(
  client: PoolClient,
  intentScopeId: string,
  observedMessageHorizon: number,
): Promise<void> {
  await client.query(
    `UPDATE intent_scopes
     SET observed_user_horizon=GREATEST(observed_user_horizon,$2)
     WHERE intent_scope_id=$1`,
    [intentScopeId, observedMessageHorizon],
  );
}

function pathKeysChangedInSuccessors(
  targetState: IntentState,
  successors: VersionRow[],
  pathKeys: ReadonlySet<string>,
): boolean {
  let previousState = targetState;
  for (const successor of successors) {
    const successorState = intentStateSchema.parse(successor.state_json);
    if (!intentStatesAgreeOnPathKeys(previousState, successorState, pathKeys)) return true;
    previousState = successorState;
  }
  return false;
}

export class PostgresIntentAuthorityStore implements IntentAuthorityStore {
  readonly kind = "postgres" as const;

  private constructor(
    private readonly pool: Pool,
    private readonly idFactory: () => string,
  ) {}

  static async migrate(connectionString: string): Promise<void> {
    const pool = new Pool({ connectionString });
    try {
      await pool.query("SELECT 1");
      await pool.query(
        "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
      );
      for (const migrationName of migrationNames) {
        const existing = await pool.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM schema_migrations WHERE name=$1",
          [migrationName],
        );
        if (existing.rows[0]?.count === "1") continue;
        const sql = await readFile(resolve(process.cwd(), "migrations", migrationName), "utf8");
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(sql);
          await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [migrationName]);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }
      await PostgresIntentAuthorityStore.assertReady(pool);
    } finally {
      await pool.end();
    }
  }

  private static async assertReady(pool: Pool): Promise<void> {
    const result = await pool.query<{
      scopes: string | null;
      versions: string | null;
      transitions: string | null;
      pending: string | null;
      horizon: string | null;
      version_lineage: string | null;
      transition_lineage: string | null;
      count: string;
    }>(
      `SELECT
         to_regclass('public.intent_scopes')::text AS scopes,
         to_regclass('public.intent_versions')::text AS versions,
         to_regclass('public.intent_transitions')::text AS transitions,
         to_regclass('public.intent_pending_proposals')::text AS pending,
         (SELECT column_name FROM information_schema.columns
          WHERE table_schema='public' AND table_name='intent_scopes' AND column_name='observed_user_horizon') AS horizon,
         (SELECT column_name FROM information_schema.columns
          WHERE table_schema='public' AND table_name='intent_versions' AND column_name='lineage_kind') AS version_lineage,
         (SELECT column_name FROM information_schema.columns
          WHERE table_schema='public' AND table_name='intent_transitions' AND column_name='lineage_kind') AS transition_lineage,
         (SELECT count(*)::text FROM schema_migrations WHERE name = ANY($1::text[])) AS count`,
      [migrationNames],
    );
    const row = result.rows[0];
    if (
      !row?.scopes || !row.versions || !row.transitions || !row.pending || !row.horizon ||
      !row.version_lineage || !row.transition_lineage || row.count !== String(migrationNames.length)
    ) {
      throw new Error("Intent Authority schema is not ready; required intent migrations are missing.");
    }
  }

  static async connect(
    connectionString: string,
    options: PostgresIntentAuthorityOptions = {},
  ): Promise<PostgresIntentAuthorityStore> {
    if (options.migrate ?? true) await PostgresIntentAuthorityStore.migrate(connectionString);
    const pool = new Pool({ connectionString });
    try {
      await pool.query("SELECT 1");
      await PostgresIntentAuthorityStore.assertReady(pool);
      return new PostgresIntentAuthorityStore(pool, options.idFactory ?? randomUUID);
    } catch (error) {
      await pool.end();
      throw error;
    }
  }

  private async findExistingTransition(
    client: PoolClient,
    command: Pick<TransitionWrite, "transitionId" | "intentScopeId" | "logicalUserTurnId">,
  ): Promise<TransitionRow | undefined> {
    const existingResult = await client.query<TransitionRow>(
      `SELECT * FROM intent_transitions
       WHERE transition_id=$1 OR (intent_scope_id=$2 AND logical_user_turn_id=$3)
       LIMIT 1`,
      [command.transitionId, command.intentScopeId, command.logicalUserTurnId],
    );
    return existingResult.rows[0];
  }

  private async loadTargetContext(
    client: PoolClient,
    scopeId: string,
    baseVersion: VersionRow,
    targetIntentVersionId: string,
  ): Promise<TargetContext | undefined> {
    const targetResult = await client.query<VersionRow>(
      "SELECT * FROM intent_versions WHERE intent_version_id=$1 AND intent_scope_id=$2",
      [targetIntentVersionId, scopeId],
    );
    const target = targetResult.rows[0];
    if (!target || Number(target.version_number) > Number(baseVersion.version_number)) return undefined;

    let beforeTargetState = emptyIntentState();
    if (target.predecessor_intent_version_id) {
      const predecessorResult = await client.query<VersionRow>(
        "SELECT * FROM intent_versions WHERE intent_version_id=$1 AND intent_scope_id=$2",
        [target.predecessor_intent_version_id, scopeId],
      );
      const predecessor = predecessorResult.rows[0];
      if (!predecessor) return undefined;
      beforeTargetState = intentStateSchema.parse(predecessor.state_json);
    }

    const successorsResult = await client.query<VersionRow>(
      `SELECT * FROM intent_versions
       WHERE intent_scope_id=$1 AND version_number>$2 AND version_number<=$3
       ORDER BY version_number ASC`,
      [scopeId, Number(target.version_number), Number(baseVersion.version_number)],
    );
    let expectedPredecessorId = target.intent_version_id;
    for (const successor of successorsResult.rows) {
      if (successor.predecessor_intent_version_id !== expectedPredecessorId) return undefined;
      expectedPredecessorId = successor.intent_version_id;
    }
    if (expectedPredecessorId !== baseVersion.intent_version_id) return undefined;

    return {
      target,
      beforeTargetState,
      targetState: intentStateSchema.parse(target.state_json),
      successors: successorsResult.rows,
    };
  }

  private async commitCandidate(
    client: PoolClient,
    scope: ScopeRow,
    baseVersion: VersionRow,
    command: TransitionWrite,
    fingerprint: string,
    candidate: IntentState,
    lineageKind: IntentVersionLineageKind,
    lineageTargetIntentVersionId: string | null,
  ): Promise<IntentTransitionResult> {
    const baseState = intentStateSchema.parse(baseVersion.state_json);
    if (intentStatesSemanticallyEqual(baseState, candidate)) {
      const versionNumber = Number(baseVersion.version_number);
      await insertTransition(
        client,
        command,
        fingerprint,
        "SEMANTIC_NOOP",
        baseVersion.intent_version_id,
        versionNumber,
        lineageKind,
        lineageTargetIntentVersionId,
      );
      return {
        disposition: "SEMANTIC_NOOP",
        resultingIntentVersionId: baseVersion.intent_version_id,
        versionNumber,
      };
    }

    const versionId = this.idFactory();
    const nextVersion = Number(scope.next_version_number);
    await client.query(
      `INSERT INTO intent_versions(
         intent_scope_id,intent_version_id,version_number,predecessor_intent_version_id,
         transition_id,lineage_kind,lineage_target_intent_version_id,state_json
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [
        command.intentScopeId, versionId, nextVersion, baseVersion.intent_version_id,
        command.transitionId, lineageKind, lineageTargetIntentVersionId, JSON.stringify(candidate),
      ],
    );
    await client.query(
      `UPDATE intent_scopes
       SET current_intent_version_id=$2,next_version_number=$3
       WHERE intent_scope_id=$1`,
      [command.intentScopeId, versionId, nextVersion + 1],
    );
    await insertTransition(
      client,
      command,
      fingerprint,
      "COMMITTED",
      versionId,
      nextVersion,
      lineageKind,
      lineageTargetIntentVersionId,
    );
    return { disposition: "COMMITTED", resultingIntentVersionId: versionId, versionNumber: nextVersion };
  }

  private async rejectInvalid(
    client: PoolClient,
    command: TransitionWrite,
    fingerprint: string,
    lineageKind: IntentVersionLineageKind,
    lineageTargetIntentVersionId: string | null,
  ): Promise<IntentTransitionResult> {
    await insertTransition(
      client,
      command,
      fingerprint,
      "REJECTED_INVALID",
      null,
      null,
      lineageKind,
      lineageTargetIntentVersionId,
    );
    return invalidResult();
  }

  async createScope(input: CreateIntentScopeInput): Promise<IntentScope> {
    const command = intentTransitionCommandSchema.parse(input.initialTransition);
    if (command.intentScopeId !== input.intentScopeId || command.baseIntentVersionId !== null) {
      throw new Error("Initial intent transition must target the new scope with a null base version.");
    }
    const state = initialIntentState(command);
    if (intentStatesSemanticallyEqual(state, emptyIntentState())) {
      throw new Error("Initial intent transition must establish canonical semantic state.");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const versionId = this.idFactory();
      await client.query(
        `INSERT INTO intent_scopes(
           intent_scope_id,scope_kind,lifecycle,current_intent_version_id,next_version_number,observed_user_horizon
         ) VALUES ($1,'decision','active',NULL,1,$2)`,
        [input.intentScopeId, command.observedMessageHorizon],
      );
      await client.query(
        `INSERT INTO intent_versions(
           intent_scope_id,intent_version_id,version_number,predecessor_intent_version_id,
           transition_id,lineage_kind,lineage_target_intent_version_id,state_json
         ) VALUES ($1,$2,1,NULL,$3,'INITIAL',NULL,$4::jsonb)`,
        [input.intentScopeId, versionId, command.transitionId, JSON.stringify(state)],
      );
      await insertTransition(
        client,
        transitionWrite(command),
        transitionCommandFingerprint(command),
        "COMMITTED",
        versionId,
        1,
        "INITIAL",
        null,
      );
      const updated = await client.query<ScopeRow>(
        `UPDATE intent_scopes
         SET current_intent_version_id=$2,next_version_number=2
         WHERE intent_scope_id=$1
         RETURNING *`,
        [input.intentScopeId, versionId],
      );
      await client.query("COMMIT");
      const row = updated.rows[0];
      if (!row?.current_intent_version_id) throw new Error("Intent scope creation failed.");
      return this.mapScope(row);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getScope(intentScopeId: string): Promise<IntentScope | undefined> {
    const result = await this.pool.query<ScopeRow>(
      "SELECT * FROM intent_scopes WHERE intent_scope_id=$1",
      [intentScopeId],
    );
    const row = result.rows[0];
    return row?.current_intent_version_id ? this.mapScope(row) : undefined;
  }

  async getVersion(intentVersionId: string): Promise<IntentVersion | undefined> {
    const result = await this.pool.query<VersionRow>(
      "SELECT * FROM intent_versions WHERE intent_version_id=$1",
      [intentVersionId],
    );
    const row = result.rows[0];
    return row ? this.mapVersion(row) : undefined;
  }

  async createPendingProposal(rawInput: CreatePendingIntentProposalInput): Promise<PendingIntentProposal> {
    const input = createPendingIntentProposalSchema.parse(rawInput);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const scopeResult = await client.query<ScopeRow>(
        "SELECT * FROM intent_scopes WHERE intent_scope_id=$1 FOR UPDATE",
        [input.intentScopeId],
      );
      const scope = scopeResult.rows[0];
      if (!scope?.current_intent_version_id || scope.current_intent_version_id !== input.baseIntentVersionId) {
        throw new Error("Pending intent proposal must bind the current exact IntentVersion.");
      }
      if (Number(scope.observed_user_horizon) > input.observedMessageHorizon) {
        throw new Error("Pending intent proposal is stale against the observed USER message horizon.");
      }
      const proposalDigest = pendingIntentProposalDigest(input);
      const result = await client.query<PendingProposalRow>(
        `INSERT INTO intent_pending_proposals(
           proposal_id,proposal_digest,intent_scope_id,base_intent_version_id,
           observed_message_horizon,source_message_id,source_digest,operations_json,
           provenance_kind,materiality,status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'INFERRED_MATERIAL','MATERIAL','PENDING')
         RETURNING *`,
        [
          input.proposalId, proposalDigest, input.intentScopeId, input.baseIntentVersionId,
          input.observedMessageHorizon, input.sourceMessageId, input.sourceDigest,
          JSON.stringify(input.operations),
        ],
      );
      await advanceObservedUserHorizon(client, input.intentScopeId, input.observedMessageHorizon);
      await client.query("COMMIT");
      const row = result.rows[0];
      if (!row) throw new Error("Pending intent proposal insert failed.");
      return this.mapPendingProposal(row);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getPendingProposal(proposalId: string): Promise<PendingIntentProposal | undefined> {
    const result = await this.pool.query<PendingProposalRow>(
      "SELECT * FROM intent_pending_proposals WHERE proposal_id=$1",
      [proposalId],
    );
    const row = result.rows[0];
    return row ? this.mapPendingProposal(row) : undefined;
  }

  async confirmPendingProposal(rawCommand: ConfirmPendingIntentProposalCommand): Promise<IntentTransitionResult> {
    let command: ConfirmPendingIntentProposalCommand;
    try {
      command = confirmPendingIntentProposalSchema.parse(rawCommand);
    } catch {
      return invalidResult();
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const proposalResult = await client.query<PendingProposalRow>(
        "SELECT * FROM intent_pending_proposals WHERE proposal_id=$1 FOR UPDATE",
        [command.proposalId],
      );
      const row = proposalResult.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return invalidResult();
      }
      const proposal = this.mapPendingProposal(row);
      if (
        command.expectedProposalDigest !== proposal.proposalDigest ||
        command.intentScopeId !== proposal.intentScopeId ||
        command.baseIntentVersionId !== proposal.baseIntentVersionId ||
        command.observedMessageHorizon <= proposal.observedMessageHorizon
      ) {
        await client.query("ROLLBACK");
        return invalidResult();
      }

      const transition: IntentTransitionCommand = {
        transitionId: command.transitionId,
        intentScopeId: command.intentScopeId,
        baseIntentVersionId: command.baseIntentVersionId,
        logicalUserTurnId: command.logicalUserTurnId,
        observedMessageHorizon: command.observedMessageHorizon,
        sourceMessageId: command.sourceMessageId,
        sourceDigest: command.sourceDigest,
        operations: structuredClone(proposal.operations),
      };
      const write = transitionWrite(transition);
      const provenance: IntentProvenance = {
        kind: "USER_CONFIRMED",
        logicalUserTurnId: command.logicalUserTurnId,
        sourceMessageId: command.sourceMessageId,
        sourceDigest: command.sourceDigest,
        proposalId: proposal.proposalId,
        proposalDigest: proposal.proposalDigest,
      };
      const fingerprint = transitionCommandFingerprint(transition, provenance);
      const existing = await this.findExistingTransition(client, write);
      if (existing) {
        await client.query("COMMIT");
        return existing.command_fingerprint === fingerprint ? replayResult(existing) : invalidResult();
      }
      if (proposal.status !== "PENDING") {
        await client.query("ROLLBACK");
        return invalidResult();
      }

      const scopeResult = await client.query<ScopeRow>(
        "SELECT * FROM intent_scopes WHERE intent_scope_id=$1 FOR UPDATE",
        [proposal.intentScopeId],
      );
      const scope = scopeResult.rows[0];
      if (
        !scope?.current_intent_version_id ||
        scope.current_intent_version_id !== proposal.baseIntentVersionId ||
        Number(scope.observed_user_horizon) > proposal.observedMessageHorizon
      ) {
        await insertTransition(client, write, fingerprint, "REJECTED_STALE", null, null, "UPDATE", null);
        await advanceObservedUserHorizon(client, proposal.intentScopeId, command.observedMessageHorizon);
        await client.query(
          "UPDATE intent_pending_proposals SET status='STALE',resolved_at=now() WHERE proposal_id=$1",
          [proposal.proposalId],
        );
        await client.query("COMMIT");
        return { disposition: "REJECTED_STALE", resultingIntentVersionId: null, versionNumber: null };
      }

      const baseVersionResult = await client.query<VersionRow>(
        "SELECT * FROM intent_versions WHERE intent_version_id=$1",
        [proposal.baseIntentVersionId],
      );
      const baseVersion = baseVersionResult.rows[0];
      if (!baseVersion) throw new Error("Pending clarification base IntentVersion is missing.");
      const baseState = intentStateSchema.parse(baseVersion.state_json);
      let candidate: IntentState;
      try {
        candidate = applyIntentOperations(baseState, transition, provenance);
      } catch {
        await client.query("ROLLBACK");
        return invalidResult();
      }

      const result = await this.commitCandidate(
        client,
        scope,
        baseVersion,
        write,
        fingerprint,
        candidate,
        "UPDATE",
        null,
      );
      await advanceObservedUserHorizon(client, proposal.intentScopeId, command.observedMessageHorizon);
      await client.query(
        `UPDATE intent_pending_proposals
         SET status='CONFIRMED',confirmed_transition_id=$2,resolved_at=now()
         WHERE proposal_id=$1`,
        [proposal.proposalId, command.transitionId],
      );
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async applyTransition(rawCommand: IntentTransitionCommand): Promise<IntentTransitionResult> {
    return this.applyTransitionInternal(rawCommand);
  }

  async applyPreferenceReuse(rawCommand: IntentPreferenceReuseCommand): Promise<IntentTransitionResult> {
    let command: IntentPreferenceReuseCommand;
    try {
      command = intentPreferenceReuseCommandSchema.parse(rawCommand);
    } catch {
      return invalidResult();
    }
    return this.applyTransitionInternal(
      preferenceReuseAsTransition(command),
      command.provenance,
      preferenceReuseFingerprint(command),
    );
  }

  private async applyTransitionInternal(
    rawCommand: IntentTransitionCommand,
    provenanceOverride?: IntentProvenance,
    fingerprintOverride?: string,
  ): Promise<IntentTransitionResult> {
    let command: IntentTransitionCommand;
    try {
      command = intentTransitionCommandSchema.parse(rawCommand);
    } catch {
      return invalidResult();
    }
    const write = transitionWrite(command);
    const fingerprint = fingerprintOverride ?? transitionCommandFingerprint(command, provenanceOverride);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const scopeResult = await client.query<ScopeRow>(
        "SELECT * FROM intent_scopes WHERE intent_scope_id=$1 FOR UPDATE",
        [command.intentScopeId],
      );
      const scope = scopeResult.rows[0];
      if (!scope?.current_intent_version_id) {
        await client.query("ROLLBACK");
        return invalidResult();
      }

      const existing = await this.findExistingTransition(client, write);
      if (existing) {
        await client.query("COMMIT");
        return existing.command_fingerprint === fingerprint ? replayResult(existing) : invalidResult();
      }

      if (command.observedMessageHorizon < Number(scope.observed_user_horizon)) {
        await insertTransition(client, write, fingerprint, "REJECTED_STALE", null, null, "UPDATE", null);
        await client.query("COMMIT");
        return { disposition: "REJECTED_STALE", resultingIntentVersionId: null, versionNumber: null };
      }
      await advanceObservedUserHorizon(client, command.intentScopeId, command.observedMessageHorizon);

      if (command.baseIntentVersionId !== scope.current_intent_version_id) {
        await insertTransition(client, write, fingerprint, "REJECTED_STALE", null, null, "UPDATE", null);
        await client.query("COMMIT");
        return { disposition: "REJECTED_STALE", resultingIntentVersionId: null, versionNumber: null };
      }

      const versionResult = await client.query<VersionRow>(
        "SELECT * FROM intent_versions WHERE intent_version_id=$1",
        [scope.current_intent_version_id],
      );
      const baseVersion = versionResult.rows[0];
      if (!baseVersion) throw new Error("Current IntentVersion is missing.");
      const baseState = intentStateSchema.parse(baseVersion.state_json);
      let candidate: IntentState;
      try {
        candidate = applyIntentOperations(baseState, command, provenanceOverride);
      } catch {
        const result = await this.rejectInvalid(client, write, fingerprint, "UPDATE", null);
        await client.query("COMMIT");
        return result;
      }

      const result = await this.commitCandidate(client, scope, baseVersion, write, fingerprint, candidate, "UPDATE", null);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async applyCorrection(rawCommand: IntentCorrectionCommand): Promise<IntentTransitionResult> {
    let command: IntentCorrectionCommand;
    try {
      command = intentCorrectionCommandSchema.parse(rawCommand);
    } catch {
      return invalidResult();
    }
    const write = correctionWrite(command);
    const fingerprint = correctionCommandFingerprint(command);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const scopeResult = await client.query<ScopeRow>(
        "SELECT * FROM intent_scopes WHERE intent_scope_id=$1 FOR UPDATE",
        [command.intentScopeId],
      );
      const scope = scopeResult.rows[0];
      if (!scope?.current_intent_version_id) {
        await client.query("ROLLBACK");
        return invalidResult();
      }
      const existing = await this.findExistingTransition(client, write);
      if (existing) {
        await client.query("COMMIT");
        return existing.command_fingerprint === fingerprint ? replayResult(existing) : invalidResult();
      }
      if (command.observedMessageHorizon < Number(scope.observed_user_horizon)) {
        await insertTransition(
          client, write, fingerprint, "REJECTED_STALE", null, null, "CORRECTION", command.correctsIntentVersionId,
        );
        await client.query("COMMIT");
        return { disposition: "REJECTED_STALE", resultingIntentVersionId: null, versionNumber: null };
      }
      await advanceObservedUserHorizon(client, command.intentScopeId, command.observedMessageHorizon);
      if (command.baseIntentVersionId !== scope.current_intent_version_id) {
        await insertTransition(
          client, write, fingerprint, "REJECTED_STALE", null, null, "CORRECTION", command.correctsIntentVersionId,
        );
        await client.query("COMMIT");
        return { disposition: "REJECTED_STALE", resultingIntentVersionId: null, versionNumber: null };
      }

      const baseResult = await client.query<VersionRow>(
        "SELECT * FROM intent_versions WHERE intent_version_id=$1",
        [scope.current_intent_version_id],
      );
      const baseVersion = baseResult.rows[0];
      if (!baseVersion) throw new Error("Current IntentVersion is missing.");
      const context = await this.loadTargetContext(client, command.intentScopeId, baseVersion, command.correctsIntentVersionId);
      if (!context) {
        const result = await this.rejectInvalid(client, write, fingerprint, "CORRECTION", command.correctsIntentVersionId);
        await client.query("COMMIT");
        return result;
      }

      const targetChangedPaths = intentStateChangedPathKeys(context.beforeTargetState, context.targetState);
      const operationPaths = intentOperationPathKeys(command.operations);
      if (
        operationPaths.size === 0 ||
        [...operationPaths].some((path) => !targetChangedPaths.has(path)) ||
        pathKeysChangedInSuccessors(context.targetState, context.successors, operationPaths)
      ) {
        const result = await this.rejectInvalid(client, write, fingerprint, "CORRECTION", command.correctsIntentVersionId);
        await client.query("COMMIT");
        return result;
      }

      let candidate: IntentState;
      try {
        candidate = applyIntentOperations(intentStateSchema.parse(baseVersion.state_json), writeAsTransitionCommand(write));
      } catch {
        const result = await this.rejectInvalid(client, write, fingerprint, "CORRECTION", command.correctsIntentVersionId);
        await client.query("COMMIT");
        return result;
      }
      const result = await this.commitCandidate(
        client,
        scope,
        baseVersion,
        write,
        fingerprint,
        candidate,
        "CORRECTION",
        command.correctsIntentVersionId,
      );
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async revertVersion(rawCommand: IntentRevertCommand): Promise<IntentTransitionResult> {
    let command: IntentRevertCommand;
    try {
      command = intentRevertCommandSchema.parse(rawCommand);
    } catch {
      return invalidResult();
    }
    const fingerprint = revertCommandFingerprint(command);
    const initialWrite = lineageWrite(command);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const scopeResult = await client.query<ScopeRow>(
        "SELECT * FROM intent_scopes WHERE intent_scope_id=$1 FOR UPDATE",
        [command.intentScopeId],
      );
      const scope = scopeResult.rows[0];
      if (!scope?.current_intent_version_id) {
        await client.query("ROLLBACK");
        return invalidResult();
      }
      const existing = await this.findExistingTransition(client, initialWrite);
      if (existing) {
        await client.query("COMMIT");
        return existing.command_fingerprint === fingerprint ? replayResult(existing) : invalidResult();
      }
      if (command.observedMessageHorizon < Number(scope.observed_user_horizon)) {
        await insertTransition(
          client, initialWrite, fingerprint, "REJECTED_STALE", null, null, "REVERT", command.revertsIntentVersionId,
        );
        await client.query("COMMIT");
        return { disposition: "REJECTED_STALE", resultingIntentVersionId: null, versionNumber: null };
      }
      await advanceObservedUserHorizon(client, command.intentScopeId, command.observedMessageHorizon);
      if (command.baseIntentVersionId !== scope.current_intent_version_id) {
        await insertTransition(
          client, initialWrite, fingerprint, "REJECTED_STALE", null, null, "REVERT", command.revertsIntentVersionId,
        );
        await client.query("COMMIT");
        return { disposition: "REJECTED_STALE", resultingIntentVersionId: null, versionNumber: null };
      }

      const baseResult = await client.query<VersionRow>(
        "SELECT * FROM intent_versions WHERE intent_version_id=$1",
        [scope.current_intent_version_id],
      );
      const baseVersion = baseResult.rows[0];
      if (!baseVersion) throw new Error("Current IntentVersion is missing.");
      const context = await this.loadTargetContext(client, command.intentScopeId, baseVersion, command.revertsIntentVersionId);
      if (!context) {
        const result = await this.rejectInvalid(client, initialWrite, fingerprint, "REVERT", command.revertsIntentVersionId);
        await client.query("COMMIT");
        return result;
      }
      const changedPaths = intentStateChangedPathKeys(context.beforeTargetState, context.targetState);
      if (changedPaths.size === 0 || pathKeysChangedInSuccessors(context.targetState, context.successors, changedPaths)) {
        const result = await this.rejectInvalid(client, initialWrite, fingerprint, "REVERT", command.revertsIntentVersionId);
        await client.query("COMMIT");
        return result;
      }

      let operations: IntentOperation[];
      try {
        operations = buildIntentRevertOperations(context.beforeTargetState, context.targetState);
      } catch {
        const result = await this.rejectInvalid(client, initialWrite, fingerprint, "REVERT", command.revertsIntentVersionId);
        await client.query("COMMIT");
        return result;
      }
      const write = lineageWrite(command, operations);
      let candidate: IntentState;
      try {
        candidate = applyIntentOperations(intentStateSchema.parse(baseVersion.state_json), writeAsTransitionCommand(write));
      } catch {
        const result = await this.rejectInvalid(client, write, fingerprint, "REVERT", command.revertsIntentVersionId);
        await client.query("COMMIT");
        return result;
      }
      const result = await this.commitCandidate(
        client,
        scope,
        baseVersion,
        write,
        fingerprint,
        candidate,
        "REVERT",
        command.revertsIntentVersionId,
      );
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async resetScope(rawCommand: IntentResetCommand): Promise<IntentTransitionResult> {
    let command: IntentResetCommand;
    try {
      command = intentResetCommandSchema.parse(rawCommand);
    } catch {
      return invalidResult();
    }
    const fingerprint = resetCommandFingerprint(command);
    const initialWrite = lineageWrite(command);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const scopeResult = await client.query<ScopeRow>(
        "SELECT * FROM intent_scopes WHERE intent_scope_id=$1 FOR UPDATE",
        [command.intentScopeId],
      );
      const scope = scopeResult.rows[0];
      if (!scope?.current_intent_version_id) {
        await client.query("ROLLBACK");
        return invalidResult();
      }
      const existing = await this.findExistingTransition(client, initialWrite);
      if (existing) {
        await client.query("COMMIT");
        return existing.command_fingerprint === fingerprint ? replayResult(existing) : invalidResult();
      }
      if (command.observedMessageHorizon < Number(scope.observed_user_horizon)) {
        await insertTransition(
          client, initialWrite, fingerprint, "REJECTED_STALE", null, null, "RESET_SUPERSEDES", command.baseIntentVersionId,
        );
        await client.query("COMMIT");
        return { disposition: "REJECTED_STALE", resultingIntentVersionId: null, versionNumber: null };
      }
      await advanceObservedUserHorizon(client, command.intentScopeId, command.observedMessageHorizon);
      if (command.baseIntentVersionId !== scope.current_intent_version_id) {
        await insertTransition(
          client, initialWrite, fingerprint, "REJECTED_STALE", null, null, "RESET_SUPERSEDES", command.baseIntentVersionId,
        );
        await client.query("COMMIT");
        return { disposition: "REJECTED_STALE", resultingIntentVersionId: null, versionNumber: null };
      }

      const baseResult = await client.query<VersionRow>(
        "SELECT * FROM intent_versions WHERE intent_version_id=$1",
        [scope.current_intent_version_id],
      );
      const baseVersion = baseResult.rows[0];
      if (!baseVersion) throw new Error("Current IntentVersion is missing.");
      const operations = buildIntentResetOperations(intentStateSchema.parse(baseVersion.state_json));
      const write = lineageWrite(command, operations);
      let candidate: IntentState;
      try {
        candidate = applyIntentOperations(intentStateSchema.parse(baseVersion.state_json), writeAsTransitionCommand(write));
      } catch {
        const result = await this.rejectInvalid(
          client, write, fingerprint, "RESET_SUPERSEDES", command.baseIntentVersionId,
        );
        await client.query("COMMIT");
        return result;
      }
      const result = await this.commitCandidate(
        client,
        scope,
        baseVersion,
        write,
        fingerprint,
        candidate,
        "RESET_SUPERSEDES",
        command.baseIntentVersionId,
      );
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private mapScope(row: ScopeRow): IntentScope {
    if (!row.current_intent_version_id) throw new Error("Intent scope has no current version.");
    return {
      intentScopeId: row.intent_scope_id,
      kind: row.scope_kind,
      lifecycle: row.lifecycle,
      currentIntentVersionId: row.current_intent_version_id,
      nextVersionNumber: Number(row.next_version_number),
      createdAt: timestamp(row.created_at),
    };
  }

  private mapVersion(row: VersionRow): IntentVersion {
    return {
      intentScopeId: row.intent_scope_id,
      intentVersionId: row.intent_version_id,
      version: Number(row.version_number),
      predecessorIntentVersionId: row.predecessor_intent_version_id,
      transitionId: row.transition_id,
      lineageKind: intentVersionLineageKindSchema.parse(row.lineage_kind),
      lineageTargetIntentVersionId: row.lineage_target_intent_version_id,
      state: intentStateSchema.parse(row.state_json),
      createdAt: timestamp(row.created_at),
    };
  }

  private mapPendingProposal(row: PendingProposalRow): PendingIntentProposal {
    return {
      proposalId: row.proposal_id,
      proposalDigest: row.proposal_digest,
      intentScopeId: row.intent_scope_id,
      baseIntentVersionId: row.base_intent_version_id,
      observedMessageHorizon: Number(row.observed_message_horizon),
      sourceMessageId: row.source_message_id,
      sourceDigest: row.source_digest,
      operations: intentOperationSchema.array().parse(row.operations_json),
      provenanceKind: row.provenance_kind,
      materiality: row.materiality,
      status: row.status,
      confirmedTransitionId: row.confirmed_transition_id,
      createdAt: timestamp(row.created_at),
      resolvedAt: row.resolved_at ? timestamp(row.resolved_at) : null,
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
