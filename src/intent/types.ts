import { z } from "zod";

export const intentScalarSchema = z.union([z.string(), z.number(), z.boolean()]);
export type IntentScalar = z.infer<typeof intentScalarSchema>;

export const intentSetValueSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("VALUE"), value: intentScalarSchema }).strict(),
  z.object({ state: z.literal("NO_PREFERENCE") }).strict(),
  z.object({ state: z.literal("OPEN") }).strict(),
  z.object({ state: z.literal("DELEGATED") }).strict(),
]);
export type IntentSetValue = z.infer<typeof intentSetValueSchema>;

export const intentValueSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("VALUE"), value: intentScalarSchema }).strict(),
  z.object({ state: z.literal("UNSPECIFIED") }).strict(),
  z.object({ state: z.literal("NO_PREFERENCE") }).strict(),
  z.object({ state: z.literal("OPEN") }).strict(),
  z.object({ state: z.literal("DELEGATED") }).strict(),
]);
export type IntentValue = z.infer<typeof intentValueSchema>;

export const UNSPECIFIED_INTENT_VALUE: IntentValue = Object.freeze({ state: "UNSPECIFIED" });

export const intentProvenanceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("EXPLICIT_USER"),
    logicalUserTurnId: z.string().min(1),
    sourceMessageId: z.string().min(1),
    sourceDigest: z.string().min(1),
  }).strict(),
  z.object({
    kind: z.literal("USER_CONFIRMED"),
    logicalUserTurnId: z.string().min(1),
    sourceMessageId: z.string().min(1),
    sourceDigest: z.string().min(1),
    proposalId: z.string().min(1),
    proposalDigest: z.string().min(1),
  }).strict(),
]);
export type IntentProvenance = z.infer<typeof intentProvenanceSchema>;

export const intentFieldSchema = z.object({
  value: intentSetValueSchema,
  provenance: intentProvenanceSchema,
}).strict();
export type IntentField = z.infer<typeof intentFieldSchema>;

export const intentStateSchema = z.object({
  objective: intentFieldSchema.nullable(),
  requirements: z.record(z.string(), intentFieldSchema),
  preferences: z.record(z.string(), intentFieldSchema),
}).strict();
export type IntentState = z.infer<typeof intentStateSchema>;

export const intentPathSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("OBJECTIVE") }).strict(),
  z.object({ kind: z.literal("REQUIREMENT"), key: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("PREFERENCE"), key: z.string().min(1) }).strict(),
]);
export type IntentPath = z.infer<typeof intentPathSchema>;

const setOperationSchema = z.object({
  op: z.literal("SET"),
  path: intentPathSchema,
  value: intentSetValueSchema,
}).strict();
const removeOperationSchema = z.object({
  op: z.literal("REMOVE"),
  path: intentPathSchema,
}).strict();
const noChangeOperationSchema = z.object({
  op: z.literal("NO_CHANGE"),
  path: intentPathSchema,
}).strict();

export const intentOperationSchema = z.discriminatedUnion("op", [
  setOperationSchema,
  removeOperationSchema,
  noChangeOperationSchema,
]);
export type IntentOperation = z.infer<typeof intentOperationSchema>;

const transitionIdentityShape = {
  transitionId: z.string().min(1),
  intentScopeId: z.string().min(1),
  baseIntentVersionId: z.string().min(1).nullable(),
  logicalUserTurnId: z.string().min(1),
  observedMessageHorizon: z.number().int().nonnegative(),
  sourceMessageId: z.string().min(1),
  sourceDigest: z.string().min(1),
};

export const intentTransitionCommandSchema = z.object({
  ...transitionIdentityShape,
  operations: z.array(intentOperationSchema).min(1),
}).strict();
export type IntentTransitionCommand = z.infer<typeof intentTransitionCommandSchema>;

export const intentCorrectionCommandSchema = z.object({
  ...transitionIdentityShape,
  baseIntentVersionId: z.string().min(1),
  correctsIntentVersionId: z.string().min(1),
  operations: z.array(intentOperationSchema).min(1),
}).strict();
export type IntentCorrectionCommand = z.infer<typeof intentCorrectionCommandSchema>;

export const intentRevertCommandSchema = z.object({
  ...transitionIdentityShape,
  baseIntentVersionId: z.string().min(1),
  revertsIntentVersionId: z.string().min(1),
}).strict();
export type IntentRevertCommand = z.infer<typeof intentRevertCommandSchema>;

export const intentResetCommandSchema = z.object({
  ...transitionIdentityShape,
  baseIntentVersionId: z.string().min(1),
}).strict();
export type IntentResetCommand = z.infer<typeof intentResetCommandSchema>;

export const intentVersionLineageKindSchema = z.enum([
  "INITIAL",
  "UPDATE",
  "CORRECTION",
  "REVERT",
  "RESET_SUPERSEDES",
]);
export type IntentVersionLineageKind = z.infer<typeof intentVersionLineageKindSchema>;

export const createPendingIntentProposalSchema = z.object({
  proposalId: z.string().min(1),
  intentScopeId: z.string().min(1),
  baseIntentVersionId: z.string().min(1),
  observedMessageHorizon: z.number().int().nonnegative(),
  sourceMessageId: z.string().min(1),
  sourceDigest: z.string().min(1),
  operations: z.array(intentOperationSchema).min(1).refine(
    (operations) => operations.every((operation) => operation.op !== "NO_CHANGE"),
    "Pending material proposals must contain semantic SET/REMOVE operations.",
  ),
  materiality: z.literal("MATERIAL"),
}).strict();
export type CreatePendingIntentProposalInput = z.infer<typeof createPendingIntentProposalSchema>;

export const confirmPendingIntentProposalSchema = z.object({
  transitionId: z.string().min(1),
  proposalId: z.string().min(1),
  expectedProposalDigest: z.string().min(1),
  intentScopeId: z.string().min(1),
  baseIntentVersionId: z.string().min(1),
  logicalUserTurnId: z.string().min(1),
  observedMessageHorizon: z.number().int().nonnegative(),
  sourceMessageId: z.string().min(1),
  sourceDigest: z.string().min(1),
}).strict();
export type ConfirmPendingIntentProposalCommand = z.infer<typeof confirmPendingIntentProposalSchema>;

export type PendingIntentProposalStatus = "PENDING" | "CONFIRMED" | "STALE";

export interface PendingIntentProposal {
  proposalId: string;
  proposalDigest: string;
  intentScopeId: string;
  baseIntentVersionId: string;
  observedMessageHorizon: number;
  sourceMessageId: string;
  sourceDigest: string;
  operations: IntentOperation[];
  provenanceKind: "INFERRED_MATERIAL";
  materiality: "MATERIAL";
  status: PendingIntentProposalStatus;
  confirmedTransitionId: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export type IntentTransitionDisposition =
  | "COMMITTED"
  | "SEMANTIC_NOOP"
  | "REPLAYED"
  | "REJECTED_STALE"
  | "REJECTED_INVALID";

export interface IntentTransitionResult {
  disposition: IntentTransitionDisposition;
  resultingIntentVersionId: string | null;
  versionNumber: number | null;
  replayedDisposition?: Exclude<IntentTransitionDisposition, "REPLAYED">;
}

export interface IntentScope {
  intentScopeId: string;
  kind: "decision" | "consultation";
  lifecycle: "active";
  currentIntentVersionId: string;
  nextVersionNumber: number;
  createdAt: string;
}

export interface IntentVersion {
  intentScopeId: string;
  intentVersionId: string;
  version: number;
  predecessorIntentVersionId: string | null;
  transitionId: string;
  lineageKind: IntentVersionLineageKind;
  lineageTargetIntentVersionId: string | null;
  state: IntentState;
  createdAt: string;
}

export interface CreateIntentScopeInput {
  intentScopeId: string;
  kind?: IntentScope["kind"];
  initialTransition: IntentTransitionCommand;
}

export function emptyIntentState(): IntentState {
  return { objective: null, requirements: {}, preferences: {} };
}

export function readIntentValue(state: IntentState, path: IntentPath): IntentValue {
  if (path.kind === "OBJECTIVE") return state.objective?.value ?? UNSPECIFIED_INTENT_VALUE;
  const field = path.kind === "REQUIREMENT"
    ? state.requirements[path.key]
    : state.preferences[path.key];
  return field?.value ?? UNSPECIFIED_INTENT_VALUE;
}

export function provenanceFor(command: IntentTransitionCommand): IntentProvenance {
  return {
    kind: "EXPLICIT_USER",
    logicalUserTurnId: command.logicalUserTurnId,
    sourceMessageId: command.sourceMessageId,
    sourceDigest: command.sourceDigest,
  };
}
