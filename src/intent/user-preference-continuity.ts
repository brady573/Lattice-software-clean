import type { IntentAuthorityStore } from "./store.js";
import {
  UserPreferenceNotFoundError,
  UserPreferenceVersionConflictError,
  type UserPreferenceStore,
} from "./user-preference-store.js";
import type { IntentPreferenceReuseCommand } from "./preference-reuse-command.js";
import type { IntentTransitionResult } from "./types.js";

export interface ReuseActiveUserPreferenceInput {
  preferenceId: string;
  ownerSubjectId: string;
  expectedPreferenceVersion: number;
  transitionId: string;
  intentScopeId: string;
  baseIntentVersionId: string;
  logicalUserTurnId: string;
  observedMessageHorizon: number;
  sourceMessageId: string;
  sourceDigest: string;
}

export async function reuseActiveUserPreference(
  preferenceStore: UserPreferenceStore,
  intentStore: IntentAuthorityStore,
  input: ReuseActiveUserPreferenceInput,
): Promise<IntentTransitionResult> {
  const preference = await preferenceStore.getActive(input.preferenceId, input.ownerSubjectId);
  if (!preference) throw new UserPreferenceNotFoundError();
  if (preference.version !== input.expectedPreferenceVersion) {
    throw new UserPreferenceVersionConflictError();
  }

  const command: IntentPreferenceReuseCommand = {
    transitionId: input.transitionId,
    intentScopeId: input.intentScopeId,
    baseIntentVersionId: input.baseIntentVersionId,
    logicalUserTurnId: input.logicalUserTurnId,
    observedMessageHorizon: input.observedMessageHorizon,
    sourceMessageId: input.sourceMessageId,
    sourceDigest: input.sourceDigest,
    preferenceId: preference.preferenceId,
    preferenceVersion: preference.version,
    semanticKey: preference.semanticKey,
    value: structuredClone(preference.value),
    provenance: structuredClone(preference.provenance),
  };
  return intentStore.applyPreferenceReuse(command);
}
