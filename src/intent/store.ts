import { randomUUID } from "node:crypto";
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
import {
  confirmPendingIntentProposalSchema,
  createPendingIntentProposalSchema,
  emptyIntentState,
  intentCorrectionCommandSchema,
  intentResetCommandSchema,
  intentRevertCommandSchema,
  intentTransitionCommandSchema,
  type ConfirmPendingIntentProposalCommand,
  type CreateIntentScopeInput,
  type CreatePendingIntentProposalInput,
  type IntentCorrectionCommand,
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
} from "./types.js";

export interface IntentAuthorityStore {
  readonly kind: "memory" | "postgres";
  createScope(input: CreateIntentScopeInput): Promise<IntentScope>;
  getScope(intentScopeId: string): Promise<IntentScope | undefined>;
  getVersion(intentVersionId: string): Promise<IntentVersion | undefined>;
  applyTransition(command: IntentTransitionCommand): Promise<IntentTransitionResult>;
  applyPreferenceReuse(command: IntentPreferenceReuseCommand): Promise<IntentTransitionResult>;
  applyCorrection(command: IntentCorrectionCommand): Promise<IntentTransitionResult>;
  revertVersion(command: IntentRevertCommand): Promise<IntentTransitionResult>;
  resetScope(command: IntentResetCommand): Promise<IntentTransitionResult>;
  createPendingProposal(input: CreatePendingIntentProposalInput): Promise<PendingIntentProposal>;
  getPendingProposal(proposalId: string): Promise<PendingIntentProposal | undefined>;
  confirmPendingProposal(command: ConfirmPendingIntentProposalCommand): Promise<IntentTransitionResult>;
  close(): Promise<void>;
}

type TransitionIdentity = Pick<
  IntentTransitionCommand,
  "transitionId" | "intentScopeId" | "baseIntentVersionId" | "logicalUserTurnId" | "observedMessageHorizon"
>;

type StoredTransition = {
  transitionId: string;
  intentScopeId: string;
  logicalUserTurnId: string;
  observedMessageHorizon: number;
  fingerprint: string;
  lineageKind: IntentVersionLineageKind;
  lineageTargetIntentVersionId: string | null;
  disposition: Exclude<IntentTransitionDisposition, "REPLAYED">;
  resultingIntentVersionId: string | null;
  versionNumber: number | null;
};

type PreflightResult =
  | { ok: true; scope: IntentScope; baseVersion: IntentVersion }
  | { ok: false; result: IntentTransitionResult };

function invalidResult(): IntentTransitionResult {
  return { disposition: "REJECTED_INVALID", resultingIntentVersionId: null, versionNumber: null };
}

function replayResult(transition: StoredTransition): IntentTransitionResult {
  return {
    disposition: "REPLAYED",
    replayedDisposition: transition.disposition,
    resultingIntentVersionId: transition.resultingIntentVersionId,
    versionNumber: transition.versionNumber,
  };
}

function transitionFromCorrection(command: IntentCorrectionCommand): IntentTransitionCommand {
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

function transitionWithOperations(
  command: IntentRevertCommand | IntentResetCommand,
  operations: IntentTransitionCommand["operations"],
): IntentTransitionCommand {
  return {
    transitionId: command.transitionId,
    intentScopeId: command.intentScopeId,
    baseIntentVersionId: command.baseIntentVersionId,
    logicalUserTurnId: command.logicalUserTurnId,
    observedMessageHorizon: command.observedMessageHorizon,
    sourceMessageId: command.sourceMessageId,
    sourceDigest: command.sourceDigest,
    operations,
  };
}

export class MemoryIntentAuthorityStore implements IntentAuthorityStore {
  readonly kind = "memory" as const;
  private readonly scopes = new Map<string, IntentScope>();
  private readonly versions = new Map<string, IntentVersion>();
  private readonly transitionsById = new Map<string, StoredTransition>();
  private readonly transitionsByTurn = new Map<string, StoredTransition>();
  private readonly pendingProposals = new Map<string, PendingIntentProposal>();
  private readonly observedUserHorizonByScope = new Map<string, number>();

  constructor(private readonly idFactory: () => string = randomUUID) {}

  private observedUserHorizon(intentScopeId: string): number {
    return this.observedUserHorizonByScope.get(intentScopeId) ?? -1;
  }

  private advanceUserHorizon(intentScopeId: string, observedMessageHorizon: number): void {
    this.observedUserHorizonByScope.set(
      intentScopeId,
      Math.max(this.observedUserHorizon(intentScopeId), observedMessageHorizon),
    );
  }

  private turnKey(identity: Pick<TransitionIdentity, "intentScopeId" | "logicalUserTurnId">): string {
    return `${identity.intentScopeId}:${identity.logicalUserTurnId}`;
  }

  private existingTransition(identity: TransitionIdentity, fingerprint: string): IntentTransitionResult | undefined {
    const existing = this.transitionsById.get(identity.transitionId) ?? this.transitionsByTurn.get(this.turnKey(identity));
    if (!existing) return undefined;
    return existing.fingerprint === fingerprint ? replayResult(existing) : invalidResult();
  }

  private recordTransition(
    identity: TransitionIdentity,
    fingerprint: string,
    disposition: Exclude<IntentTransitionDisposition, "REPLAYED">,
    resultingIntentVersionId: string | null,
    versionNumber: number | null,
    lineageKind: IntentVersionLineageKind,
    lineageTargetIntentVersionId: string | null,
  ): StoredTransition {
    const transition: StoredTransition = {
      transitionId: identity.transitionId,
      intentScopeId: identity.intentScopeId,
      logicalUserTurnId: identity.logicalUserTurnId,
      observedMessageHorizon: identity.observedMessageHorizon,
      fingerprint,
      lineageKind,
      lineageTargetIntentVersionId,
      disposition,
      resultingIntentVersionId,
      versionNumber,
    };
    this.transitionsById.set(identity.transitionId, transition);
    this.transitionsByTurn.set(this.turnKey(identity), transition);
    return transition;
  }

  private preflight(
    identity: TransitionIdentity,
    fingerprint: string,
    lineageKind: IntentVersionLineageKind,
    lineageTargetIntentVersionId: string | null,
  ): PreflightResult {
    const replay = this.existingTransition(identity, fingerprint);
    if (replay) return { ok: false, result: replay };

    const scope = this.scopes.get(identity.intentScopeId);
    if (!scope) return { ok: false, result: invalidResult() };
    if (identity.observedMessageHorizon < this.observedUserHorizon(identity.intentScopeId)) {
      this.recordTransition(
        identity,
        fingerprint,
        "REJECTED_STALE",
        null,
        null,
        lineageKind,
        lineageTargetIntentVersionId,
      );
      return {
        ok: false,
        result: { disposition: "REJECTED_STALE", resultingIntentVersionId: null, versionNumber: null },
      };
    }
    this.advanceUserHorizon(identity.intentScopeId, identity.observedMessageHorizon);

    if (identity.baseIntentVersionId !== scope.currentIntentVersionId) {
      this.recordTransition(
        identity,
        fingerprint,
        "REJECTED_STALE",
        null,
        null,
        lineageKind,
        lineageTargetIntentVersionId,
      );
      return {
        ok: false,
        result: { disposition: "REJECTED_STALE", resultingIntentVersionId: null, versionNumber: null },
      };
    }
    const baseVersion = this.versions.get(scope.currentIntentVersionId);
    if (!baseVersion) return { ok: false, result: invalidResult() };
    return { ok: true, scope, baseVersion };
  }

  private rejectInvalid(
    identity: TransitionIdentity,
    fingerprint: string,
    lineageKind: IntentVersionLineageKind,
    lineageTargetIntentVersionId: string | null,
  ): IntentTransitionResult {
    this.recordTransition(
      identity,
      fingerprint,
      "REJECTED_INVALID",
      null,
      null,
      lineageKind,
      lineageTargetIntentVersionId,
    );
    return invalidResult();
  }

  private commitCandidate(
    identity: TransitionIdentity,
    fingerprint: string,
    scope: IntentScope,
    baseVersion: IntentVersion,
    candidate: IntentState,
    lineageKind: IntentVersionLineageKind,
    lineageTargetIntentVersionId: string | null,
  ): IntentTransitionResult {
    if (intentStatesSemanticallyEqual(baseVersion.state, candidate)) {
      this.recordTransition(
        identity,
        fingerprint,
        "SEMANTIC_NOOP",
        baseVersion.intentVersionId,
        baseVersion.version,
        lineageKind,
        lineageTargetIntentVersionId,
      );
      return {
        disposition: "SEMANTIC_NOOP",
        resultingIntentVersionId: baseVersion.intentVersionId,
        versionNumber: baseVersion.version,
      };
    }

    const versionId = this.idFactory();
    const version: IntentVersion = {
      intentScopeId: identity.intentScopeId,
      intentVersionId: versionId,
      version: scope.nextVersionNumber,
      predecessorIntentVersionId: baseVersion.intentVersionId,
      transitionId: identity.transitionId,
      lineageKind,
      lineageTargetIntentVersionId,
      state: candidate,
      createdAt: new Date().toISOString(),
    };
    this.versions.set(versionId, structuredClone(version));
    scope.currentIntentVersionId = versionId;
    scope.nextVersionNumber += 1;
    for (const proposal of this.pendingProposals.values()) {
      if (
        proposal.status === "PENDING"
        && proposal.intentScopeId === identity.intentScopeId
        && proposal.baseIntentVersionId !== versionId
      ) {
        proposal.status = "STALE";
        proposal.resolvedAt = new Date().toISOString();
      }
    }
    this.recordTransition(
      identity,
      fingerprint,
      "COMMITTED",
      versionId,
      version.version,
      lineageKind,
      lineageTargetIntentVersionId,
    );
    return { disposition: "COMMITTED", resultingIntentVersionId: versionId, versionNumber: version.version };
  }

  private targetContext(
    baseVersion: IntentVersion,
    targetIntentVersionId: string,
  ): { target: IntentVersion; beforeTarget: IntentState; successors: IntentVersion[] } | undefined {
    const target = this.versions.get(targetIntentVersionId);
    if (!target || target.intentScopeId !== baseVersion.intentScopeId) return undefined;

    const successors: IntentVersion[] = [];
    let cursor = baseVersion;
    while (cursor.intentVersionId !== targetIntentVersionId) {
      successors.push(cursor);
      if (!cursor.predecessorIntentVersionId) return undefined;
      const predecessor = this.versions.get(cursor.predecessorIntentVersionId);
      if (!predecessor) return undefined;
      cursor = predecessor;
    }

    let beforeTarget = emptyIntentState();
    if (target.predecessorIntentVersionId) {
      const predecessor = this.versions.get(target.predecessorIntentVersionId);
      if (!predecessor) return undefined;
      beforeTarget = predecessor.state;
    }
    return { target, beforeTarget, successors };
  }

  private pathKeysChangedAfterTarget(successors: IntentVersion[], pathKeys: ReadonlySet<string>): boolean {
    for (const successor of successors) {
      if (!successor.predecessorIntentVersionId) return true;
      const predecessor = this.versions.get(successor.predecessorIntentVersionId);
      if (!predecessor) return true;
      if (!intentStatesAgreeOnPathKeys(predecessor.state, successor.state, pathKeys)) return true;
    }
    return false;
  }

  async createScope(input: CreateIntentScopeInput): Promise<IntentScope> {
    const command = intentTransitionCommandSchema.parse(input.initialTransition);
    if (command.intentScopeId !== input.intentScopeId || command.baseIntentVersionId !== null) {
      throw new Error("Initial intent transition must target the new scope with a null base version.");
    }
    if (this.scopes.has(input.intentScopeId)) throw new Error("Intent scope already exists.");
    const state = initialIntentState(command);
    if (intentStatesSemanticallyEqual(state, emptyIntentState())) {
      throw new Error("Initial intent transition must establish canonical semantic state.");
    }
    const now = new Date().toISOString();
    const versionId = this.idFactory();
    const version: IntentVersion = {
      intentScopeId: input.intentScopeId,
      intentVersionId: versionId,
      version: 1,
      predecessorIntentVersionId: null,
      transitionId: command.transitionId,
      lineageKind: "INITIAL",
      lineageTargetIntentVersionId: null,
      state,
      createdAt: now,
    };
    const scope: IntentScope = {
      intentScopeId: input.intentScopeId,
      kind: input.kind ?? "decision",
      lifecycle: "active",
      currentIntentVersionId: versionId,
      nextVersionNumber: 2,
      createdAt: now,
    };
    this.scopes.set(scope.intentScopeId, structuredClone(scope));
    this.versions.set(versionId, structuredClone(version));
    this.recordTransition(command, transitionCommandFingerprint(command), "COMMITTED", versionId, 1, "INITIAL", null);
    this.advanceUserHorizon(input.intentScopeId, command.observedMessageHorizon);
    return structuredClone(scope);
  }

  async getScope(intentScopeId: string): Promise<IntentScope | undefined> {
    const scope = this.scopes.get(intentScopeId);
    return scope ? structuredClone(scope) : undefined;
  }

  async getVersion(intentVersionId: string): Promise<IntentVersion | undefined> {
    const version = this.versions.get(intentVersionId);
    return version ? structuredClone(version) : undefined;
  }

  async createPendingProposal(rawInput: CreatePendingIntentProposalInput): Promise<PendingIntentProposal> {
    const input = createPendingIntentProposalSchema.parse(rawInput);
    if (this.pendingProposals.has(input.proposalId)) throw new Error("Pending intent proposal already exists.");
    const scope = this.scopes.get(input.intentScopeId);
    if (!scope || scope.currentIntentVersionId !== input.baseIntentVersionId) {
      throw new Error("Pending intent proposal must bind the current exact IntentVersion.");
    }
    if (this.observedUserHorizon(input.intentScopeId) > input.observedMessageHorizon) {
      throw new Error("Pending intent proposal is stale against the observed USER message horizon.");
    }
    const proposal: PendingIntentProposal = {
      proposalId: input.proposalId,
      proposalDigest: pendingIntentProposalDigest(input),
      intentScopeId: input.intentScopeId,
      baseIntentVersionId: input.baseIntentVersionId,
      observedMessageHorizon: input.observedMessageHorizon,
      sourceMessageId: input.sourceMessageId,
      sourceDigest: input.sourceDigest,
      operations: structuredClone(input.operations),
      provenanceKind: "INFERRED_MATERIAL",
      materiality: "MATERIAL",
      status: "PENDING",
      confirmedTransitionId: null,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    };
    this.pendingProposals.set(proposal.proposalId, structuredClone(proposal));
    this.advanceUserHorizon(input.intentScopeId, input.observedMessageHorizon);
    return structuredClone(proposal);
  }

  async getPendingProposal(proposalId: string): Promise<PendingIntentProposal | undefined> {
    const proposal = this.pendingProposals.get(proposalId);
    return proposal ? structuredClone(proposal) : undefined;
  }

  async confirmPendingProposal(rawCommand: ConfirmPendingIntentProposalCommand): Promise<IntentTransitionResult> {
    let command: ConfirmPendingIntentProposalCommand;
    try {
      command = confirmPendingIntentProposalSchema.parse(rawCommand);
    } catch {
      return invalidResult();
    }
    const proposal = this.pendingProposals.get(command.proposalId);
    if (!proposal) return invalidResult();

    if (
      command.expectedProposalDigest !== proposal.proposalDigest ||
      command.intentScopeId !== proposal.intentScopeId ||
      command.baseIntentVersionId !== proposal.baseIntentVersionId ||
      command.observedMessageHorizon <= proposal.observedMessageHorizon
    ) return invalidResult();

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
    const provenance: IntentProvenance = {
      kind: "USER_CONFIRMED",
      logicalUserTurnId: command.logicalUserTurnId,
      sourceMessageId: command.sourceMessageId,
      sourceDigest: command.sourceDigest,
      proposalId: proposal.proposalId,
      proposalDigest: proposal.proposalDigest,
    };
    const fingerprint = transitionCommandFingerprint(transition, provenance);
    const replay = this.existingTransition(transition, fingerprint);
    if (replay) return replay;

    if (proposal.status !== "PENDING") return invalidResult();
    const scope = this.scopes.get(proposal.intentScopeId);
    if (
      !scope ||
      scope.currentIntentVersionId !== proposal.baseIntentVersionId ||
      this.observedUserHorizon(proposal.intentScopeId) > proposal.observedMessageHorizon
    ) {
      this.recordTransition(transition, fingerprint, "REJECTED_STALE", null, null, "UPDATE", null);
      this.advanceUserHorizon(command.intentScopeId, command.observedMessageHorizon);
      proposal.status = "STALE";
      proposal.resolvedAt = new Date().toISOString();
      return { disposition: "REJECTED_STALE", resultingIntentVersionId: null, versionNumber: null };
    }

    const result = await this.applyTransitionInternal(transition, provenance);
    if (
      result.disposition === "COMMITTED" ||
      result.disposition === "SEMANTIC_NOOP" ||
      (result.disposition === "REPLAYED" &&
        (result.replayedDisposition === "COMMITTED" || result.replayedDisposition === "SEMANTIC_NOOP"))
    ) {
      proposal.status = "CONFIRMED";
      proposal.confirmedTransitionId = command.transitionId;
      proposal.resolvedAt = new Date().toISOString();
    } else if (result.disposition === "REJECTED_STALE") {
      proposal.status = "STALE";
      proposal.resolvedAt = new Date().toISOString();
    }
    return result;
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
    const fingerprint = fingerprintOverride ?? transitionCommandFingerprint(command, provenanceOverride);
    const preflight = this.preflight(command, fingerprint, "UPDATE", null);
    if (!preflight.ok) return preflight.result;

    let candidate;
    try {
      candidate = applyIntentOperations(preflight.baseVersion.state, command, provenanceOverride);
    } catch {
      return this.rejectInvalid(command, fingerprint, "UPDATE", null);
    }
    return this.commitCandidate(
      command,
      fingerprint,
      preflight.scope,
      preflight.baseVersion,
      candidate,
      "UPDATE",
      null,
    );
  }

  async applyCorrection(rawCommand: IntentCorrectionCommand): Promise<IntentTransitionResult> {
    let command: IntentCorrectionCommand;
    try {
      command = intentCorrectionCommandSchema.parse(rawCommand);
    } catch {
      return invalidResult();
    }
    const fingerprint = correctionCommandFingerprint(command);
    const preflight = this.preflight(command, fingerprint, "CORRECTION", command.correctsIntentVersionId);
    if (!preflight.ok) return preflight.result;

    const context = this.targetContext(preflight.baseVersion, command.correctsIntentVersionId);
    if (!context) return this.rejectInvalid(command, fingerprint, "CORRECTION", command.correctsIntentVersionId);
    const targetChangedPaths = intentStateChangedPathKeys(context.beforeTarget, context.target.state);
    const operationPaths = intentOperationPathKeys(command.operations);
    if (
      operationPaths.size === 0 ||
      [...operationPaths].some((path) => !targetChangedPaths.has(path)) ||
      this.pathKeysChangedAfterTarget(context.successors, operationPaths)
    ) {
      return this.rejectInvalid(command, fingerprint, "CORRECTION", command.correctsIntentVersionId);
    }

    const transition = transitionFromCorrection(command);
    let candidate;
    try {
      candidate = applyIntentOperations(preflight.baseVersion.state, transition);
    } catch {
      return this.rejectInvalid(command, fingerprint, "CORRECTION", command.correctsIntentVersionId);
    }
    return this.commitCandidate(
      command,
      fingerprint,
      preflight.scope,
      preflight.baseVersion,
      candidate,
      "CORRECTION",
      command.correctsIntentVersionId,
    );
  }

  async revertVersion(rawCommand: IntentRevertCommand): Promise<IntentTransitionResult> {
    let command: IntentRevertCommand;
    try {
      command = intentRevertCommandSchema.parse(rawCommand);
    } catch {
      return invalidResult();
    }
    const fingerprint = revertCommandFingerprint(command);
    const preflight = this.preflight(command, fingerprint, "REVERT", command.revertsIntentVersionId);
    if (!preflight.ok) return preflight.result;

    const context = this.targetContext(preflight.baseVersion, command.revertsIntentVersionId);
    if (!context) return this.rejectInvalid(command, fingerprint, "REVERT", command.revertsIntentVersionId);
    const changedPaths = intentStateChangedPathKeys(context.beforeTarget, context.target.state);
    if (changedPaths.size === 0 || this.pathKeysChangedAfterTarget(context.successors, changedPaths)) {
      return this.rejectInvalid(command, fingerprint, "REVERT", command.revertsIntentVersionId);
    }

    let operations;
    try {
      operations = buildIntentRevertOperations(context.beforeTarget, context.target.state);
    } catch {
      return this.rejectInvalid(command, fingerprint, "REVERT", command.revertsIntentVersionId);
    }
    const transition = transitionWithOperations(command, operations);
    let candidate;
    try {
      candidate = applyIntentOperations(preflight.baseVersion.state, transition);
    } catch {
      return this.rejectInvalid(command, fingerprint, "REVERT", command.revertsIntentVersionId);
    }
    return this.commitCandidate(
      command,
      fingerprint,
      preflight.scope,
      preflight.baseVersion,
      candidate,
      "REVERT",
      command.revertsIntentVersionId,
    );
  }

  async resetScope(rawCommand: IntentResetCommand): Promise<IntentTransitionResult> {
    let command: IntentResetCommand;
    try {
      command = intentResetCommandSchema.parse(rawCommand);
    } catch {
      return invalidResult();
    }
    const fingerprint = resetCommandFingerprint(command);
    const preflight = this.preflight(command, fingerprint, "RESET_SUPERSEDES", command.baseIntentVersionId);
    if (!preflight.ok) return preflight.result;

    const transition = transitionWithOperations(command, buildIntentResetOperations(preflight.baseVersion.state));
    let candidate;
    try {
      candidate = applyIntentOperations(preflight.baseVersion.state, transition);
    } catch {
      return this.rejectInvalid(command, fingerprint, "RESET_SUPERSEDES", command.baseIntentVersionId);
    }
    return this.commitCandidate(
      command,
      fingerprint,
      preflight.scope,
      preflight.baseVersion,
      candidate,
      "RESET_SUPERSEDES",
      command.baseIntentVersionId,
    );
  }

  async close(): Promise<void> {
    this.scopes.clear();
    this.versions.clear();
    this.transitionsById.clear();
    this.transitionsByTurn.clear();
    this.pendingProposals.clear();
    this.observedUserHorizonByScope.clear();
  }
}
