import type { IntentOperation, IntentVersion } from "./types.js";

export type ConsultationResourceNeed = "NONE" | "CHECKLIST" | "PREPARED_MESSAGE";

export interface ConsultationInterpretationInput {
  readonly message: string;
  readonly context: readonly string[];
  readonly currentIntentVersion?: IntentVersion;
  readonly explicitResourceNeed?: Exclude<ConsultationResourceNeed, "NONE">;
}

export type ConsultationObjectiveEffect =
  | { readonly kind: "ESTABLISH"; readonly value: string }
  | { readonly kind: "REPLACE_EXPLICIT"; readonly value: string }
  | { readonly kind: "PRESERVE" };

export type ConsultationMeaningKind =
  | "EXPLICIT_OBJECTIVE"
  | "EXPLICIT_CORRECTION"
  | "ADDITIONAL_CONTEXT"
  | "REQUIREMENT_OR_PREFERENCE_UPDATE"
  | "CONFIRMATION"
  | "RESOURCE_OR_EXPLANATION_REQUEST"
  | "MATERIAL_INFERENCE";

export interface MaterialIntentClarificationProposal {
  /**
   * Non-authoritative semantic operations proposed from USER language. Intent
   * Authority must keep these pending until the USER confirms them.
   */
  readonly operations: readonly IntentOperation[];
  readonly question: string;
  readonly confirmationExample: string;
}

export interface ConsultationInterpretationProposal {
  /** Proposed objective effect. Intent Authority remains the only writer. */
  readonly objectiveEffect: ConsultationObjectiveEffect;
  readonly meaningKind: ConsultationMeaningKind;
  readonly decisionRequested: boolean;
  readonly resourceNeed: ConsultationResourceNeed;
  readonly materialClarification?: MaterialIntentClarificationProposal;
  /** Missing referent/scope question; it proposes no authoritative meaning. */
  readonly clarificationQuestion?: string;
}

/**
 * Provider-neutral, non-authoritative interpretation boundary. Implementations
 * may propose structured meaning, but proposed decision semantics cannot enter
 * an IntentVersion until Intent Authority receives explicit USER confirmation.
 */
export interface ConsultationInterpreter {
  interpret(input: ConsultationInterpretationInput): Promise<ConsultationInterpretationProposal>;
}

/**
 * Conservative Product default. It preserves ordinary free-form USER language
 * verbatim and detects only an explicit, reversible preparation request. It
 * proposes no decision semantics and therefore cannot manufacture criteria,
 * constraints, priorities, candidates, or a qualified decision need.
 */
export class ConservativeConsultationInterpreter implements ConsultationInterpreter {
  async interpret(input: ConsultationInterpretationInput): Promise<ConsultationInterpretationProposal> {
    const message = input.message.trim();
    const existingObjective = input.currentIntentVersion?.state.objective;
    const hasObjective = existingObjective?.value.state === "VALUE"
      && typeof existingObjective.value.value === "string";
    const explicitCorrection = hasObjective
      ? /^(?:no\s*[,;:-]?\s*actually\s*[,;:-]?\s*|actually\s*[,;:-]?\s*i\s+meant\s+|actually\s*[,;:-]?\s*(?:my|the)\s+objective\s+(?:is|should be)\s+|i\s+mean(?:t)?\s+|(?:change|replace|update)\s+(?:the\s+)?objective\s+(?:to\s+)?|instead\s*[,;:-]?\s*)(.+)$/iu.exec(message)
      : null;
    const objectiveEffect: ConsultationObjectiveEffect = !hasObjective
      ? { kind: "ESTABLISH", value: message }
      : explicitCorrection?.[1]?.trim()
        ? { kind: "REPLACE_EXPLICIT", value: explicitCorrection[1].trim() }
        : { kind: "PRESERVE" };
    if (input.explicitResourceNeed) {
      return {
        objectiveEffect,
        meaningKind: "RESOURCE_OR_EXPLANATION_REQUEST",
        decisionRequested: false,
        resourceNeed: input.explicitResourceNeed,
      };
    }

    const normalized = message.toLocaleLowerCase("en-US");
    const missingReferent = !hasObjective
      && /^(?:is|was|will|would|could|can|should)\s+(?:this|that|it|these|those|they)\b/iu.test(message);
    const asksToPrepare = /\b(?:prepare|create|make|build|draft|write|compose)\b/u.test(normalized);
    const resourceNeed: ConsultationResourceNeed = asksToPrepare && /\b(?:checklist|check list)\b/u.test(normalized)
      ? "CHECKLIST"
      : asksToPrepare && /\b(?:message|email|note|reply|response)\b/u.test(normalized)
        ? "PREPARED_MESSAGE"
        : "NONE";

    const meaningKind: ConsultationMeaningKind = objectiveEffect.kind === "ESTABLISH"
      ? "EXPLICIT_OBJECTIVE"
      : objectiveEffect.kind === "REPLACE_EXPLICIT"
        ? "EXPLICIT_CORRECTION"
        : resourceNeed !== "NONE" || /\b(?:why|source|explain|show|tell me|what about)\b/iu.test(message)
          ? "RESOURCE_OR_EXPLANATION_REQUEST"
          : "ADDITIONAL_CONTEXT";
    return {
      objectiveEffect,
      meaningKind,
      decisionRequested: false,
      resourceNeed,
      ...(missingReferent
        ? { clarificationQuestion: "What does the referenced subject refer to? Please restate the question with that material context." }
        : {}),
    };
  }
}
