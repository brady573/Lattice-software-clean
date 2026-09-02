import type {
  ApiRunControlStore,
  ApiRunSubmissionInput,
  ApiRunSubmissionResult,
  ApiRunSupersessionInput,
  ApiRunSupersessionResult,
} from "../api-control-store.js";
import {
  decisionPlanIdForRun,
  type DecisionPlanStore,
} from "./decision-plan-store.js";

export class DecisionPlanRecordingApiRunControlStore implements ApiRunControlStore {
  constructor(
    private readonly base: ApiRunControlStore,
    private readonly decisionPlanStore: DecisionPlanStore,
  ) {}

  private async bindPlan(input: ApiRunSubmissionInput): Promise<void> {
    if (!input.intentBinding) return;
    await this.decisionPlanStore.bind({
      decisionPlanId: decisionPlanIdForRun(input.run.id),
      runId: input.run.id,
      intentScopeId: input.intentBinding.intentScopeId,
      intentVersionId: input.intentBinding.intentVersionId,
      planningMaterial: structuredClone(input.run.request),
    });
  }

  async submitRun(input: ApiRunSubmissionInput): Promise<ApiRunSubmissionResult> {
    await this.bindPlan(input);
    return this.base.submitRun(input);
  }

  async supersedeRun(input: ApiRunSupersessionInput): Promise<ApiRunSupersessionResult> {
    await this.decisionPlanStore.bind({
      decisionPlanId: decisionPlanIdForRun(input.supersession.successorRun.id),
      runId: input.supersession.successorRun.id,
      intentScopeId: input.supersession.successorBinding.intentScopeId,
      intentVersionId: input.supersession.successorBinding.intentVersionId,
      planningMaterial: structuredClone(input.supersession.successorRun.request),
    });
    return this.base.supersedeRun(input);
  }

  async close(): Promise<void> {
    await this.base.close();
    await this.decisionPlanStore.close();
  }
}
