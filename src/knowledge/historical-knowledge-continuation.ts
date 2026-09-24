import type { KnowledgeOutcome } from "../outcome.js";
import {
  appendConversationReference,
  type ConversationReferenceStore,
} from "../conversation/conversation-reference-store.js";
import type { SolandraKnowledgePresenter } from "../solandra/knowledge-presenter.js";
import { renderHistoricalSources, type LoadedKnowledge } from "./knowledge-continuity.js";
import type { KnowledgeRecordStore } from "./knowledge-record-store.js";

/**
 * Solandra-owned historical Knowledge reference help. This boundary never
 * interprets ordinary language and never admits or reconstructs Knowledge; it
 * only performs the existing governed continuation orchestration for a
 * requested help value that cognition has already proposed.
 */
export type HistoricalKnowledgeReferenceHelp =
  | "SOURCES_REFERENCE"
  | "EXPLAIN_REFERENCE"
  | "SIMPLIFY_REFERENCE";

export interface HistoricalKnowledgeContinuationInput {
  readonly requestedHelp: HistoricalKnowledgeReferenceHelp;
  readonly conversationId: string;
  readonly referencedKnowledgeId: string;
  /** Already-admitted conversation Knowledge; never re-derived from wording. */
  readonly governedKnowledge: readonly LoadedKnowledge[];
  readonly userMessageId: string;
  readonly userMessageCreatedAt: string;
  readonly intentScopeId: string;
  readonly currentIntentVersionId: string | undefined;
  readonly acceptedUnderstanding: string | undefined;
  /**
   * Presence is a prerequisite of historical reference continuation: without the
   * Knowledge store this conversation has no governed Knowledge authority to
   * continue. This operation never acquires or rebuilds Knowledge.
   */
  readonly knowledgeStore: KnowledgeRecordStore | undefined;
  /** Mandatory governed continuity infrastructure; absence is a composition failure. */
  readonly conversationReferenceStore: ConversationReferenceStore;
  readonly solandraKnowledgePresenter: SolandraKnowledgePresenter | undefined;
  /** Public cognition payload the route already exposes for this turn. */
  readonly interpretation: unknown;
}

export interface HistoricalKnowledgeReferenceResponseBody {
  status: "REFERENCE_RESOLVED";
  acceptedUnderstanding: string;
  intentScopeId: string;
  intentVersionId: string;
  knowledge: KnowledgeOutcome;
  knowledgeReference: {
    knowledgeId: string;
    referenceId: string;
    responseId: string;
  };
  presentation: { assistantMessage: string };
  interpretation: unknown;
}

export type HistoricalKnowledgeContinuationResult =
  | { readonly kind: "REFERENCE_RESOLVED"; readonly body: HistoricalKnowledgeReferenceResponseBody }
  | { readonly kind: "KNOWLEDGE_NOT_FOUND" }
  | { readonly kind: "SOLANDRA_KNOWLEDGE_PRESENTATION_UNAVAILABLE" }
  | { readonly kind: "GOVERNED_KNOWLEDGE_REFERENCE_UNAVAILABLE" };

/**
 * Governed historical Knowledge / reference continuation.
 *
 * Solandra cognition continues to own ordinary-language interpretation and the
 * requestedHelp proposal. Intent authority stays in the current IntentVersion,
 * Knowledge/V36 authority stays in the established governed Knowledge,
 * ConversationReference remains the continuity and admission boundary, and the
 * Solandra Knowledge presenter remains the only expression capability. This
 * operation only orchestrates those existing owners and reports an outcome the
 * HTTP composition surface can answer.
 */
export async function continueHistoricalKnowledge(
  input: HistoricalKnowledgeContinuationInput,
): Promise<HistoricalKnowledgeContinuationResult> {
  if (
    !input.knowledgeStore
    || input.currentIntentVersionId === undefined
    || input.acceptedUnderstanding === undefined
  ) {
    return { kind: "GOVERNED_KNOWLEDGE_REFERENCE_UNAVAILABLE" };
  }

  const loaded = input.governedKnowledge.find((item) =>
    item.record.knowledgeId === input.referencedKnowledgeId);
  if (!loaded || loaded.record.conversationId !== input.conversationId) {
    return { kind: "KNOWLEDGE_NOT_FOUND" };
  }

  let assistantMessage: string;
  if (input.requestedHelp === "SOURCES_REFERENCE") {
    assistantMessage = renderHistoricalSources(loaded);
  } else {
    if (!input.solandraKnowledgePresenter) {
      return { kind: "SOLANDRA_KNOWLEDGE_PRESENTATION_UNAVAILABLE" };
    }
    const presented = await input.solandraKnowledgePresenter.present({
      knowledgeId: loaded.record.knowledgeId,
      userMessageId: input.userMessageId,
      mode: input.requestedHelp === "SIMPLIFY_REFERENCE" ? "SIMPLIFY" : "EXPLAIN",
      knowledge: loaded.knowledge,
    });
    if (presented.status === "PRESENTED") {
      assistantMessage = presented.text;
    } else if (presented.status === "NEEDS_NEW_KNOWLEDGE") {
      assistantMessage = [
        "That transformation would require additional factual Knowledge beyond what is already established. I did not start new research.",
        "The existing governed Knowledge remains available and unchanged.",
        renderHistoricalSources(loaded),
      ].join("\n\n");
    } else {
      assistantMessage = presented.text ?? [
        "I couldn\'t transform the established Knowledge faithfully, so I kept the original governed wording. I did not start new research.",
        loaded.knowledge.findings.map((finding) => finding.text).join("\\n\\n"),
        "The existing governed Knowledge remains available and unchanged.",
        renderHistoricalSources(loaded),
      ].filter(Boolean).join("\\n\\n");
    }
  }

  const reference = await appendConversationReference(input.conversationReferenceStore, {
    conversationId: input.conversationId,
    userMessageId: input.userMessageId,
    responseId: `knowledge:${loaded.record.knowledgeId}:reference:${input.userMessageId}`,
    intentVersionId: input.currentIntentVersionId,
    targets: [{ kind: "KNOWLEDGE", targetId: loaded.record.knowledgeId, relation: "CONSUMED" }],
    createdAt: input.userMessageCreatedAt,
  });
  if (!reference) {
    return { kind: "GOVERNED_KNOWLEDGE_REFERENCE_UNAVAILABLE" };
  }

  return {
    kind: "REFERENCE_RESOLVED",
    body: {
      status: "REFERENCE_RESOLVED",
      acceptedUnderstanding: input.acceptedUnderstanding,
      intentScopeId: input.intentScopeId,
      intentVersionId: input.currentIntentVersionId,
      knowledge: loaded.knowledge,
      knowledgeReference: {
        knowledgeId: loaded.record.knowledgeId,
        referenceId: reference.referenceId,
        responseId: reference.responseId,
      },
      presentation: { assistantMessage },
      interpretation: input.interpretation,
    },
  };
}
