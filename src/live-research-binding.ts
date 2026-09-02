import type { RunStatus } from "./domain.js";
import type { ConversationStore } from "./conversation/conversation-store.js";
import type { IntentBoundRunStore } from "./intent/run-binding.js";
import type { DurableResearchTask } from "./orchestration-store.js";
import type { RunStore } from "./run-store.js";

export type LiveResearchBindingFailureCode =
  | "RUN_UNAVAILABLE"
  | "RUN_NOT_RESEARCHABLE"
  | "RUN_EPOCH_MISMATCH"
  | "INTENT_BINDING_UNAVAILABLE"
  | "CONVERSATION_UNAVAILABLE"
  | "BINDING_CHANGED";

export class LiveResearchBindingError extends Error {
  constructor(
    readonly code: LiveResearchBindingFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "LiveResearchBindingError";
  }
}

export interface LiveResearchBinding {
  readonly runId: string;
  readonly runEpoch: number;
  readonly runStatus: "INVESTIGATING";
  readonly conversationId: string;
  readonly subjectId: string;
  readonly intentScopeId: string;
  readonly intentVersionId: string;
}

export interface LiveResearchBindingStores {
  readonly runStore: Pick<RunStore, "get">;
  readonly runBindingStore: Pick<IntentBoundRunStore, "getBinding">;
  readonly conversationStore: Pick<ConversationStore, "get">;
}

function isResearchableStatus(status: RunStatus): status is "INVESTIGATING" {
  return status === "INVESTIGATING";
}

/**
 * Re-derives the Product-owned subject and exact IntentVersion binding for a
 * durable V36 research task immediately before any external research dispatch.
 * The durable task carries execution identity, not independent auth authority.
 */
export async function resolveLiveResearchBinding(
  stores: LiveResearchBindingStores,
  task: Pick<DurableResearchTask, "runId" | "runEpoch">,
): Promise<LiveResearchBinding> {
  const run = await stores.runStore.get(task.runId);
  if (!run) {
    throw new LiveResearchBindingError("RUN_UNAVAILABLE", "Live research Run is unavailable.");
  }
  if (!isResearchableStatus(run.status)) {
    throw new LiveResearchBindingError(
      "RUN_NOT_RESEARCHABLE",
      `Live research requires an INVESTIGATING Run; observed ${run.status}.`,
    );
  }
  if (run.version !== task.runEpoch) {
    throw new LiveResearchBindingError(
      "RUN_EPOCH_MISMATCH",
      "Live research task no longer matches the exact Run epoch.",
    );
  }

  const intentBinding = await stores.runBindingStore.getBinding(run.id);
  if (!intentBinding) {
    throw new LiveResearchBindingError(
      "INTENT_BINDING_UNAVAILABLE",
      "Live research requires an exact persisted IntentVersion binding.",
    );
  }

  const conversation = await stores.conversationStore.get(run.conversationId);
  if (!conversation) {
    throw new LiveResearchBindingError(
      "CONVERSATION_UNAVAILABLE",
      "Live research requires an active owned Conversation.",
    );
  }

  return Object.freeze({
    runId: run.id,
    runEpoch: run.version,
    runStatus: "INVESTIGATING" as const,
    conversationId: conversation.id,
    subjectId: conversation.ownerSubjectId,
    intentScopeId: intentBinding.intentScopeId,
    intentVersionId: intentBinding.intentVersionId,
  });
}

/**
 * Last-safe-boundary recheck used after an external operation but before its
 * result may be persisted/exposed. Any subject, intent, Conversation, Run
 * status, or Run-epoch movement invalidates the original live binding.
 */
export async function assertLiveResearchBindingStillActive(
  stores: LiveResearchBindingStores,
  expected: LiveResearchBinding,
): Promise<void> {
  let current: LiveResearchBinding;
  try {
    current = await resolveLiveResearchBinding(stores, {
      runId: expected.runId,
      runEpoch: expected.runEpoch,
    });
  } catch (error) {
    if (error instanceof LiveResearchBindingError) {
      throw new LiveResearchBindingError(
        "BINDING_CHANGED",
        `Live research binding changed after dispatch: ${error.code}.`,
      );
    }
    throw error;
  }

  if (
    current.conversationId !== expected.conversationId
    || current.subjectId !== expected.subjectId
    || current.intentScopeId !== expected.intentScopeId
    || current.intentVersionId !== expected.intentVersionId
  ) {
    throw new LiveResearchBindingError(
      "BINDING_CHANGED",
      "Live research binding changed after dispatch.",
    );
  }
}
