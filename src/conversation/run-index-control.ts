import type {
  ApiRunControlStore,
  ApiRunSubmissionInput,
  ApiRunSubmissionResult,
  ApiRunSupersessionInput,
  ApiRunSupersessionResult,
} from "../api-control-store.js";
import type { ConversationRunIndexStore } from "./run-index-store.js";

export class ConversationRunIndexRecordingApiRunControlStore implements ApiRunControlStore {
  constructor(
    private readonly base: ApiRunControlStore,
    private readonly runIndexStore: ConversationRunIndexStore,
  ) {}

  async submitRun(input: ApiRunSubmissionInput): Promise<ApiRunSubmissionResult> {
    const result = await this.base.submitRun(input);
    if (result.outcome === "created" || result.outcome === "existing") {
      await this.runIndexStore.record(input.run);
    }
    return result;
  }

  async supersedeRun(input: ApiRunSupersessionInput): Promise<ApiRunSupersessionResult> {
    const result = await this.base.supersedeRun(input);
    if (result.outcome === "superseded" || result.outcome === "replayed") {
      await this.runIndexStore.record(input.supersession.successorRun);
    }
    return result;
  }

  async close(): Promise<void> {
    await this.base.close();
    await this.runIndexStore.close();
  }
}
