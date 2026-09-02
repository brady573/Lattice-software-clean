import { z } from "zod";
import {
  intentProvenanceSchema,
  intentSetValueSchema,
  type IntentTransitionCommand,
} from "./types.js";

export const intentPreferenceReuseCommandSchema = z.object({
  transitionId: z.string().min(1),
  intentScopeId: z.string().min(1),
  baseIntentVersionId: z.string().min(1),
  logicalUserTurnId: z.string().min(1),
  observedMessageHorizon: z.number().int().nonnegative(),
  sourceMessageId: z.string().min(1),
  sourceDigest: z.string().min(1),
  preferenceId: z.string().min(1),
  preferenceVersion: z.number().int().positive(),
  semanticKey: z.string().min(1).refine((key) => key.trim() === key, "semanticKey must be trimmed."),
  value: intentSetValueSchema,
  provenance: intentProvenanceSchema,
}).strict();

export type IntentPreferenceReuseCommand = z.infer<typeof intentPreferenceReuseCommandSchema>;

export function preferenceReuseAsTransition(command: IntentPreferenceReuseCommand): IntentTransitionCommand {
  return {
    transitionId: command.transitionId,
    intentScopeId: command.intentScopeId,
    baseIntentVersionId: command.baseIntentVersionId,
    logicalUserTurnId: command.logicalUserTurnId,
    observedMessageHorizon: command.observedMessageHorizon,
    sourceMessageId: command.sourceMessageId,
    sourceDigest: command.sourceDigest,
    operations: [{
      op: "SET",
      path: { kind: "PREFERENCE", key: command.semanticKey },
      value: structuredClone(command.value),
    }],
  };
}

export function preferenceReuseFingerprint(command: IntentPreferenceReuseCommand): string {
  return JSON.stringify({
    kind: "USER_PREFERENCE_REUSE",
    preferenceId: command.preferenceId,
    preferenceVersion: command.preferenceVersion,
    transitionId: command.transitionId,
    intentScopeId: command.intentScopeId,
    baseIntentVersionId: command.baseIntentVersionId,
    logicalUserTurnId: command.logicalUserTurnId,
    observedMessageHorizon: command.observedMessageHorizon,
    sourceMessageId: command.sourceMessageId,
    sourceDigest: command.sourceDigest,
    semanticKey: command.semanticKey,
    value: command.value,
    provenance: command.provenance,
  });
}
