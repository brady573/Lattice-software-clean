import type { IntentOperation } from "./types.js";

export type ConsultationResourceNeed = "NONE" | "CHECKLIST" | "PREPARED_MESSAGE";

export interface ConsultationInterpretationInput {
  readonly message: string;
  readonly context: readonly string[];
  readonly explicitResourceNeed?: Exclude<ConsultationResourceNeed, "NONE">;
}

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
  /** The exact USER-authored objective retained as authoritative provenance. */
  readonly objective: string;
  readonly decisionRequested: boolean;
  readonly resourceNeed: ConsultationResourceNeed;
  readonly materialClarification?: MaterialIntentClarificationProposal;
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
    const objective = input.message.trim();
    if (input.explicitResourceNeed) {
      return {
        objective,
        decisionRequested: false,
        resourceNeed: input.explicitResourceNeed,
      };
    }

    const normalized = objective.toLocaleLowerCase("en-US");
    const asksToPrepare = /\b(?:prepare|create|make|build|draft|write|compose)\b/u.test(normalized);
    const resourceNeed: ConsultationResourceNeed = asksToPrepare && /\b(?:checklist|check list)\b/u.test(normalized)
      ? "CHECKLIST"
      : asksToPrepare && /\b(?:message|email|note|reply|response)\b/u.test(normalized)
        ? "PREPARED_MESSAGE"
        : "NONE";

    return { objective, decisionRequested: false, resourceNeed };
  }
}
