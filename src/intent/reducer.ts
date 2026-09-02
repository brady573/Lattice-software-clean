import { createHash } from "node:crypto";
import {
  createPendingIntentProposalSchema,
  emptyIntentState,
  intentCorrectionCommandSchema,
  intentResetCommandSchema,
  intentRevertCommandSchema,
  intentStateSchema,
  intentTransitionCommandSchema,
  provenanceFor,
  readIntentValue,
  type CreatePendingIntentProposalInput,
  type IntentCorrectionCommand,
  type IntentField,
  type IntentOperation,
  type IntentPath,
  type IntentProvenance,
  type IntentResetCommand,
  type IntentRevertCommand,
  type IntentSetValue,
  type IntentState,
  type IntentTransitionCommand,
} from "./types.js";

export function intentPathKey(path: IntentPath): string {
  return path.kind === "OBJECTIVE" ? "OBJECTIVE" : `${path.kind}:${path.key}`;
}

function canonicalOperations(command: Pick<IntentTransitionCommand, "operations">): unknown[] {
  return [...command.operations]
    .map((operation) => ({ ...operation, key: intentPathKey(operation.path) }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function normalizeState(state: IntentState): unknown {
  const normalizeField = (field: IntentField | null): unknown => field === null ? null : field.value;
  const normalizeRecord = (record: Record<string, IntentField>): Record<string, unknown> =>
    Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]?.value]));
  return {
    objective: normalizeField(state.objective),
    requirements: normalizeRecord(state.requirements),
    preferences: normalizeRecord(state.preferences),
  };
}

function valueEquals(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function pathFromKey(key: string): IntentPath {
  if (key === "OBJECTIVE") return { kind: "OBJECTIVE" };
  if (key.startsWith("REQUIREMENT:")) {
    return { kind: "REQUIREMENT", key: key.slice("REQUIREMENT:".length) };
  }
  if (key.startsWith("PREFERENCE:")) {
    return { kind: "PREFERENCE", key: key.slice("PREFERENCE:".length) };
  }
  throw new Error(`Invalid canonical intent path key: ${key}`);
}

function allPathKeys(left: IntentState, right: IntentState): string[] {
  return [
    "OBJECTIVE",
    ...new Set([
      ...Object.keys(left.requirements).map((key) => `REQUIREMENT:${key}`),
      ...Object.keys(right.requirements).map((key) => `REQUIREMENT:${key}`),
      ...Object.keys(left.preferences).map((key) => `PREFERENCE:${key}`),
      ...Object.keys(right.preferences).map((key) => `PREFERENCE:${key}`),
    ]),
  ].sort();
}

export function intentStatesSemanticallyEqual(left: IntentState, right: IntentState): boolean {
  return JSON.stringify(normalizeState(left)) === JSON.stringify(normalizeState(right));
}

export function intentStateChangedPathKeys(before: IntentState, after: IntentState): Set<string> {
  const changed = new Set<string>();
  for (const key of allPathKeys(before, after)) {
    const path = pathFromKey(key);
    if (!valueEquals(readIntentValue(before, path), readIntentValue(after, path))) changed.add(key);
  }
  return changed;
}

export function intentOperationPathKeys(operations: IntentOperation[]): Set<string> {
  return new Set(operations.map((operation) => intentPathKey(operation.path)));
}

export function intentStatesAgreeOnPathKeys(
  left: IntentState,
  right: IntentState,
  pathKeys: ReadonlySet<string>,
): boolean {
  for (const key of pathKeys) {
    const path = pathFromKey(key);
    if (!valueEquals(readIntentValue(left, path), readIntentValue(right, path))) return false;
  }
  return true;
}

export function buildIntentRevertOperations(beforeTarget: IntentState, target: IntentState): IntentOperation[] {
  const changed = intentStateChangedPathKeys(beforeTarget, target);
  if (changed.size === 0) throw new Error("Target IntentVersion does not contain a semantic change to revert.");
  return [...changed].sort().map((key): IntentOperation => {
    const path = pathFromKey(key);
    const value = readIntentValue(beforeTarget, path);
    if (value.state === "UNSPECIFIED") return { op: "REMOVE", path };
    return { op: "SET", path, value: value as IntentSetValue };
  });
}

export function buildIntentResetOperations(state: IntentState): IntentOperation[] {
  const operations: IntentOperation[] = [];
  if (state.objective !== null) operations.push({ op: "REMOVE", path: { kind: "OBJECTIVE" } });
  for (const key of Object.keys(state.requirements).sort()) {
    operations.push({ op: "REMOVE", path: { kind: "REQUIREMENT", key } });
  }
  for (const key of Object.keys(state.preferences).sort()) {
    operations.push({ op: "REMOVE", path: { kind: "PREFERENCE", key } });
  }
  return operations.length > 0
    ? operations
    : [{ op: "NO_CHANGE", path: { kind: "OBJECTIVE" } }];
}

export function applyIntentOperations(
  baseState: IntentState,
  rawCommand: IntentTransitionCommand,
  provenanceOverride?: IntentProvenance,
): IntentState {
  const base = intentStateSchema.parse(baseState);
  const command = intentTransitionCommandSchema.parse(rawCommand);
  const candidate = structuredClone(base);
  const seen = new Set<string>();
  const provenance = provenanceOverride ?? provenanceFor(command);

  for (const operation of command.operations) {
    const key = intentPathKey(operation.path);
    if (seen.has(key)) throw new Error(`Duplicate intent operation path: ${key}`);
    seen.add(key);

    if (operation.path.kind !== "OBJECTIVE" && operation.path.key.trim() !== operation.path.key) {
      throw new Error("Intent path keys must not contain leading or trailing whitespace.");
    }

    if (
      operation.op === "SET"
      && operation.value.state === "DELEGATED"
      && operation.path.kind !== "PREFERENCE"
    ) {
      throw new Error("Bounded delegation may only be committed on a preference dimension.");
    }

    if (operation.op === "NO_CHANGE") continue;

    if (operation.path.kind === "OBJECTIVE") {
      candidate.objective = operation.op === "REMOVE"
        ? null
        : { value: structuredClone(operation.value), provenance: structuredClone(provenance) };
      continue;
    }

    const target = operation.path.kind === "REQUIREMENT"
      ? candidate.requirements
      : candidate.preferences;
    if (operation.op === "REMOVE") delete target[operation.path.key];
    else target[operation.path.key] = {
      value: structuredClone(operation.value),
      provenance: structuredClone(provenance),
    };
  }

  return intentStateSchema.parse(candidate);
}

export function transitionCommandFingerprint(
  rawCommand: IntentTransitionCommand,
  provenanceOverride?: IntentProvenance,
): string {
  const command = intentTransitionCommandSchema.parse(rawCommand);
  return JSON.stringify({
    intentScopeId: command.intentScopeId,
    baseIntentVersionId: command.baseIntentVersionId,
    logicalUserTurnId: command.logicalUserTurnId,
    observedMessageHorizon: command.observedMessageHorizon,
    sourceMessageId: command.sourceMessageId,
    sourceDigest: command.sourceDigest,
    operations: canonicalOperations(command),
    provenance: provenanceOverride ?? provenanceFor(command),
  });
}

export function correctionCommandFingerprint(rawCommand: IntentCorrectionCommand): string {
  const command = intentCorrectionCommandSchema.parse(rawCommand);
  return JSON.stringify({
    lineageKind: "CORRECTION",
    lineageTargetIntentVersionId: command.correctsIntentVersionId,
    intentScopeId: command.intentScopeId,
    baseIntentVersionId: command.baseIntentVersionId,
    logicalUserTurnId: command.logicalUserTurnId,
    observedMessageHorizon: command.observedMessageHorizon,
    sourceMessageId: command.sourceMessageId,
    sourceDigest: command.sourceDigest,
    operations: canonicalOperations({ operations: command.operations }),
  });
}

export function revertCommandFingerprint(rawCommand: IntentRevertCommand): string {
  const command = intentRevertCommandSchema.parse(rawCommand);
  return JSON.stringify({
    lineageKind: "REVERT",
    lineageTargetIntentVersionId: command.revertsIntentVersionId,
    intentScopeId: command.intentScopeId,
    baseIntentVersionId: command.baseIntentVersionId,
    logicalUserTurnId: command.logicalUserTurnId,
    observedMessageHorizon: command.observedMessageHorizon,
    sourceMessageId: command.sourceMessageId,
    sourceDigest: command.sourceDigest,
  });
}

export function resetCommandFingerprint(rawCommand: IntentResetCommand): string {
  const command = intentResetCommandSchema.parse(rawCommand);
  return JSON.stringify({
    lineageKind: "RESET_SUPERSEDES",
    lineageTargetIntentVersionId: command.baseIntentVersionId,
    intentScopeId: command.intentScopeId,
    baseIntentVersionId: command.baseIntentVersionId,
    logicalUserTurnId: command.logicalUserTurnId,
    observedMessageHorizon: command.observedMessageHorizon,
    sourceMessageId: command.sourceMessageId,
    sourceDigest: command.sourceDigest,
  });
}

export function pendingIntentProposalDigest(raw: CreatePendingIntentProposalInput): string {
  const proposal = createPendingIntentProposalSchema.parse(raw);
  const canonical = JSON.stringify({
    intentScopeId: proposal.intentScopeId,
    baseIntentVersionId: proposal.baseIntentVersionId,
    observedMessageHorizon: proposal.observedMessageHorizon,
    sourceMessageId: proposal.sourceMessageId,
    sourceDigest: proposal.sourceDigest,
    operations: canonicalOperations({ operations: proposal.operations }),
    provenanceKind: "INFERRED_MATERIAL",
    materiality: proposal.materiality,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function initialIntentState(command: IntentTransitionCommand): IntentState {
  return applyIntentOperations(emptyIntentState(), command);
}
