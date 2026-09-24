import type {
  ConversationReferenceRecord,
  ConversationReferenceStore,
  ConversationReferenceTargetKind,
} from "./conversation-reference-store.js";

export function producedTargetIds(
  references: readonly ConversationReferenceRecord[],
  kind: ConversationReferenceTargetKind,
): Set<string> {
  return new Set(references.flatMap((reference) =>
    reference.targets
      .filter((target) => target.kind === kind && target.relation === "PRODUCED")
      .map((target) => target.targetId)));
}

/**
 * Governed visibility gate for a conversation target.
 *
 * The ConversationReference store is mandatory: absence of reference
 * infrastructure is a composition failure, never an implicit admission. A
 * governed object is visible in canonical surfaces only when its exact
 * PRODUCED ConversationReference exists.
 */
export async function isProducedConversationTarget(
  store: ConversationReferenceStore,
  conversationId: string,
  kind: ConversationReferenceTargetKind,
  targetId: string,
): Promise<boolean> {
  return producedTargetIds(await store.listByConversation(conversationId), kind).has(targetId);
}
