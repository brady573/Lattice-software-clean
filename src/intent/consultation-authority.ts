import type { IntentPreferenceReuseCommand } from "./preference-reuse-command.js";
import type { IntentAuthorityStore } from "./store.js";
import type {
  ConfirmPendingIntentProposalCommand,
  CreateIntentScopeInput,
  CreatePendingIntentProposalInput,
  IntentCorrectionCommand,
  IntentResetCommand,
  IntentRevertCommand,
  IntentScope,
  IntentTransitionCommand,
} from "./types.js";

function consultationScope(scope: IntentScope | undefined): IntentScope | undefined {
  if (!scope) return undefined;
  if (!scope.intentScopeId.startsWith("consultation:")) return scope;
  return { ...scope, kind: "consultation" };
}

/** Primary consultation view over the existing exact-version Intent Authority. */
export class ConsultationIntentAuthorityStore implements IntentAuthorityStore {
  readonly kind: "memory" | "postgres";

  constructor(private readonly base: IntentAuthorityStore) {
    this.kind = base.kind;
  }

  async createScope(input: CreateIntentScopeInput) {
    const created = await this.base.createScope({ ...input, kind: "consultation" });
    return consultationScope(created)!;
  }

  async getScope(intentScopeId: string) {
    return consultationScope(await this.base.getScope(intentScopeId));
  }

  getVersion(intentVersionId: string) { return this.base.getVersion(intentVersionId); }
  applyTransition(command: IntentTransitionCommand) { return this.base.applyTransition(command); }
  applyPreferenceReuse(command: IntentPreferenceReuseCommand) { return this.base.applyPreferenceReuse(command); }
  applyCorrection(command: IntentCorrectionCommand) { return this.base.applyCorrection(command); }
  revertVersion(command: IntentRevertCommand) { return this.base.revertVersion(command); }
  resetScope(command: IntentResetCommand) { return this.base.resetScope(command); }
  createPendingProposal(input: CreatePendingIntentProposalInput) { return this.base.createPendingProposal(input); }
  getPendingProposal(proposalId: string) { return this.base.getPendingProposal(proposalId); }
  confirmPendingProposal(command: ConfirmPendingIntentProposalCommand) { return this.base.confirmPendingProposal(command); }

  async close(): Promise<void> { await this.base.close(); }
}
