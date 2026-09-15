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
      // The conversation Run index is a deterministic projection, not Run
      // authority. A projection outage must not turn an already committed Run
      // into an apparent failed submission. Any later exact replay retries the
      // same idempotent projection write from authoritative Run identity.
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
