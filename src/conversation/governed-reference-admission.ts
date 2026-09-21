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

export async function isProducedConversationTarget(
  store: ConversationReferenceStore | undefined,
  conversationId: string,
  kind: ConversationReferenceTargetKind,
  targetId: string,
): Promise<boolean> {
  if (!store) return true;
  return producedTargetIds(await store.listByConversation(conversationId), kind).has(targetId);
}
