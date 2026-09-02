export type ExternalContextRole = "MODEL_ASSISTANCE" | "RESEARCH";

export type ConversationProjectionState = "ACTIVE" | "DELETED";
export type PreferenceProjectionState = "ACTIVE" | "REVOKED";

export interface ContextProjectionConversation {
  readonly conversationId: string;
  readonly ownerSubjectId: string;
  readonly state: ConversationProjectionState;
}

export interface ContextProjectionUserTurn {
  readonly messageId: string;
  readonly conversationId: string;
  readonly content: string;
  readonly intentScopeId: string;
  readonly intentVersionId: string;
}

export interface ContextProjectionIntent {
  readonly ownerSubjectId: string;
  readonly intentScopeId: string;
  readonly intentVersionId: string;
  readonly values: Readonly<Record<string, unknown>>;
}

export interface ContextProjectionRun {
  readonly runId: string;
  readonly subjectId: string;
  readonly intentScopeId: string;
  readonly intentVersionId: string;
  readonly taskDescription: string;
}

export interface ContextProjectionPreference {
  readonly ownerSubjectId: string;
  readonly semanticKey: string;
  readonly state: PreferenceProjectionState;
  readonly value: unknown;
  readonly copiedIntoIntentVersionId?: string;
}

export interface ContextProjectionResearchMaterial {
  readonly runId: string;
  readonly checkpointId: string;
  readonly queryMaterial: string;
}

export interface ContextProjectionPriorResult {
  readonly resultId: string;
  readonly runId: string;
  readonly kind: "OPERATIONAL";
  readonly value: unknown;
}

export interface ContextProjectionPolicy {
  readonly includeCurrentUserTurn: boolean;
  readonly intentKeys?: readonly string[];
  readonly licensedPreferenceKeys?: readonly string[];
  readonly includeResearchMaterial?: boolean;
  readonly licensedPriorResultIds?: readonly string[];
  readonly maxBytes: number;
}

export interface ExternalContextProjectionInput {
  readonly subjectId: string;
  readonly role: ExternalContextRole;
  readonly conversation: ContextProjectionConversation;
  readonly currentUserTurn: ContextProjectionUserTurn;
  readonly intent: ContextProjectionIntent;
  readonly run: ContextProjectionRun;
  readonly preferences?: readonly ContextProjectionPreference[];
  readonly research?: ContextProjectionResearchMaterial;
  readonly priorResults?: readonly ContextProjectionPriorResult[];
  readonly policy: ContextProjectionPolicy;
}

export interface ExternalContextProjection {
  readonly role: ExternalContextRole;
  readonly runId: string;
  readonly intentScopeId: string;
  readonly intentVersionId: string;
  readonly currentUserTurn?: Readonly<{
    messageId: string;
    content: string;
  }>;
  readonly intentValues?: Readonly<Record<string, unknown>>;
  readonly preferences?: Readonly<Record<string, unknown>>;
  readonly research?: Readonly<{
    checkpointId: string;
    queryMaterial: string;
  }>;
  readonly priorOperationalResults?: readonly Readonly<{
    resultId: string;
    value: unknown;
  }>[];
}

export class ContextProjectionError extends Error {
  constructor(
    readonly code:
      | "INVALID_INPUT"
      | "SUBJECT_MISMATCH"
      | "CONVERSATION_UNAVAILABLE"
      | "BINDING_MISMATCH"
      | "PREFERENCE_NOT_LICENSED"
      | "PREFERENCE_UNAVAILABLE"
      | "RESEARCH_NOT_LICENSED"
      | "PRIOR_RESULT_NOT_LICENSED"
      | "SECRET_MATERIAL"
      | "PROJECTION_TOO_LARGE",
    message: string,
  ) {
    super(message);
    this.name = "ContextProjectionError";
  }
}

const secretKeyPattern = /(secret|password|credential|authorization|api[_-]?key|access[_-]?token|refresh[_-]?token)/i;
const secretValuePatterns = [
  /^Bearer\s+\S+/i,
  /^sk-[A-Za-z0-9_-]{8,}$/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

function requireNonEmpty(value: string, label: string, max = 4096): string {
  if (value.trim().length === 0) {
    throw new ContextProjectionError("INVALID_INPUT", `${label} must be non-empty.`);
  }
  if (value.length > max) {
    throw new ContextProjectionError("INVALID_INPUT", `${label} exceeds ${max} characters.`);
  }
  return value;
}

function unique(values: readonly string[] | undefined, label: string): readonly string[] {
  if (values === undefined) return [];
  const normalized = values.map((value) => requireNonEmpty(value, label, 256));
  if (new Set(normalized).size !== normalized.length) {
    throw new ContextProjectionError("INVALID_INPUT", `${label} contains duplicates.`);
  }
  return Object.freeze(normalized);
}

function assertNoSecretMaterial(value: unknown, path = "projection"): void {
  if (typeof value === "string") {
    if (secretValuePatterns.some((pattern) => pattern.test(value))) {
      throw new ContextProjectionError("SECRET_MATERIAL", `${path} contains secret-like material.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecretMaterial(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (secretKeyPattern.test(key)) {
      throw new ContextProjectionError("SECRET_MATERIAL", `${path}.${key} is a forbidden secret-bearing field.`);
    }
    assertNoSecretMaterial(entry, `${path}.${key}`);
  }
}

function cloneSafe<T>(value: T): T {
  return structuredClone(value);
}

function assertBindings(input: ExternalContextProjectionInput): void {
  const subjectId = requireNonEmpty(input.subjectId, "subjectId", 256);
  if (input.conversation.ownerSubjectId !== subjectId || input.intent.ownerSubjectId !== subjectId || input.run.subjectId !== subjectId) {
    throw new ContextProjectionError("SUBJECT_MISMATCH", "Context sources must belong to the exact authenticated subject.");
  }
  if (input.conversation.state !== "ACTIVE") {
    throw new ContextProjectionError("CONVERSATION_UNAVAILABLE", "Deleted Conversation state cannot be projected externally.");
  }
  if (input.currentUserTurn.conversationId !== input.conversation.conversationId) {
    throw new ContextProjectionError("BINDING_MISMATCH", "Current USER turn must belong to the bound Conversation.");
  }
  if (
    input.currentUserTurn.intentScopeId !== input.intent.intentScopeId
    || input.currentUserTurn.intentVersionId !== input.intent.intentVersionId
    || input.run.intentScopeId !== input.intent.intentScopeId
    || input.run.intentVersionId !== input.intent.intentVersionId
  ) {
    throw new ContextProjectionError("BINDING_MISMATCH", "Conversation turn, IntentVersion, and Run must share the exact intent binding.");
  }
  if (!Number.isSafeInteger(input.policy.maxBytes) || input.policy.maxBytes < 1) {
    throw new ContextProjectionError("INVALID_INPUT", "policy.maxBytes must be a positive safe integer.");
  }
}

function projectIntentValues(
  intent: ContextProjectionIntent,
  keys: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  if (keys.length === 0) return undefined;
  const projected: Record<string, unknown> = {};
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(intent.values, key)) {
      throw new ContextProjectionError("INVALID_INPUT", `Intent projection key ${key} is unavailable on the exact IntentVersion.`);
    }
    projected[key] = cloneSafe(intent.values[key]);
  }
  return Object.freeze(projected);
}

function projectPreferences(
  input: ExternalContextProjectionInput,
  keys: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  if (keys.length === 0) return undefined;
  const all = input.preferences ?? [];
  const projected: Record<string, unknown> = {};
  for (const key of keys) {
    const preference = all.find((candidate) => candidate.semanticKey === key && candidate.ownerSubjectId === input.subjectId);
    if (!preference) {
      throw new ContextProjectionError("PREFERENCE_NOT_LICENSED", `Preference ${key} is not available for the exact subject.`);
    }
    if (preference.state !== "ACTIVE") {
      throw new ContextProjectionError("PREFERENCE_UNAVAILABLE", `Preference ${key} is revoked.`);
    }
    if (preference.copiedIntoIntentVersionId !== undefined && preference.copiedIntoIntentVersionId !== input.intent.intentVersionId) {
      throw new ContextProjectionError("BINDING_MISMATCH", `Preference ${key} is copied into a different IntentVersion.`);
    }
    projected[key] = cloneSafe(preference.value);
  }
  return Object.freeze(projected);
}

function projectResearch(input: ExternalContextProjectionInput): ExternalContextProjection["research"] {
  if (input.policy.includeResearchMaterial !== true) return undefined;
  if (!input.research) {
    throw new ContextProjectionError("RESEARCH_NOT_LICENSED", "Research material was requested but not supplied by the exact Run.");
  }
  if (input.research.runId !== input.run.runId) {
    throw new ContextProjectionError("BINDING_MISMATCH", "Research material must bind the exact Run.");
  }
  return Object.freeze({
    checkpointId: requireNonEmpty(input.research.checkpointId, "research.checkpointId", 256),
    queryMaterial: requireNonEmpty(input.research.queryMaterial, "research.queryMaterial", 64 * 1024),
  });
}

function projectPriorResults(
  input: ExternalContextProjectionInput,
  licensedIds: readonly string[],
): ExternalContextProjection["priorOperationalResults"] {
  if (licensedIds.length === 0) return undefined;
  const all = input.priorResults ?? [];
  return Object.freeze(licensedIds.map((resultId) => {
    const result = all.find((candidate) => candidate.resultId === resultId);
    if (!result) {
      throw new ContextProjectionError("PRIOR_RESULT_NOT_LICENSED", `Prior result ${resultId} is not explicitly licensed.`);
    }
    if (result.runId !== input.run.runId || result.kind !== "OPERATIONAL") {
      throw new ContextProjectionError("BINDING_MISMATCH", `Prior result ${resultId} is outside the exact operational Run boundary.`);
    }
    return Object.freeze({ resultId, value: cloneSafe(result.value) });
  }));
}

/**
 * Builds the minimum Product-owned context that may cross an external model/provider
 * boundary for one exact Run. Durable Conversation history and account-wide preference
 * inventories are intentionally absent from this API; callers must license each projected
 * semantic field or operational result explicitly.
 */
export function buildExternalContextProjection(
  input: ExternalContextProjectionInput,
): ExternalContextProjection {
  assertBindings(input);
  const intentKeys = unique(input.policy.intentKeys, "policy.intentKeys");
  const preferenceKeys = unique(input.policy.licensedPreferenceKeys, "policy.licensedPreferenceKeys");
  const priorResultIds = unique(input.policy.licensedPriorResultIds, "policy.licensedPriorResultIds");
  const intentValues = projectIntentValues(input.intent, intentKeys);
  const preferences = projectPreferences(input, preferenceKeys);
  const research = projectResearch(input);
  const priorOperationalResults = projectPriorResults(input, priorResultIds);

  const projection: ExternalContextProjection = Object.freeze({
    role: input.role,
    runId: requireNonEmpty(input.run.runId, "run.runId", 256),
    intentScopeId: requireNonEmpty(input.intent.intentScopeId, "intent.intentScopeId", 256),
    intentVersionId: requireNonEmpty(input.intent.intentVersionId, "intent.intentVersionId", 256),
    ...(input.policy.includeCurrentUserTurn
      ? {
          currentUserTurn: Object.freeze({
            messageId: requireNonEmpty(input.currentUserTurn.messageId, "currentUserTurn.messageId", 256),
            content: requireNonEmpty(input.currentUserTurn.content, "currentUserTurn.content", 64 * 1024),
          }),
        }
      : {}),
    ...(intentValues === undefined ? {} : { intentValues }),
    ...(preferences === undefined ? {} : { preferences }),
    ...(research === undefined ? {} : { research }),
    ...(priorOperationalResults === undefined ? {} : { priorOperationalResults }),
  });

  assertNoSecretMaterial(projection);
  const bytes = Buffer.byteLength(JSON.stringify(projection), "utf8");
  if (bytes > input.policy.maxBytes) {
    throw new ContextProjectionError(
      "PROJECTION_TOO_LARGE",
      `External context projection exceeded ${input.policy.maxBytes} bytes.`,
    );
  }
  return projection;
}
