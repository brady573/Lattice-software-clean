import type {
  ApiRunControlStore,
  ApiRunSubmissionInput,
  ApiRunSubmissionResult,
  ApiRunSupersessionInput,
  ApiRunSupersessionResult,
} from "../api-control-store.js";
import type { LatticeRun } from "../domain.js";
import type { ConversationRunIndexStore } from "./run-index-store.js";

export class ConversationRunIndexRecordingApiRunControlStore implements ApiRunControlStore {
  constructor(
    private readonly base: ApiRunControlStore,
    private readonly runIndexStore: ConversationRunIndexStore,
  ) {}

  private async repairProjection(run: LatticeRun): Promise<void> {
    try {
      await this.runIndexStore.record(run);
    } catch {
      // The conversation Run index is a derived projection, not Run authority.
      // Do not convert an already committed Run into an apparent failed
      // submission, but do make the projection failure observable. Durable
      // reconnect reads reconcile from authoritative Run/conversation state.
      console.warn("Conversation Run index projection write failed; authoritative Run remains committed and reconnect reconciliation is required.");
    }
  }

  async submitRun(input: ApiRunSubmissionInput): Promise<ApiRunSubmissionResult> {
    const result = await this.base.submitRun(input);
    if (result.outcome === "created" || result.outcome === "existing") {
      await this.repairProjection(input.run);
    }
    return result;
  }

  async supersedeRun(input: ApiRunSupersessionInput): Promise<ApiRunSupersessionResult> {
    const result = await this.base.supersedeRun(input);
    if (result.outcome === "superseded" || result.outcome === "replayed") {
      await this.repairProjection(input.supersession.successorRun);
    }
    return result;
  }

  async close(): Promise<void> {
    await this.base.close();
    await this.runIndexStore.close();
  }
}
