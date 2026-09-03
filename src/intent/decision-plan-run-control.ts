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
import { isConsultationRunRequest } from "../domain.js";

export class DecisionPlanRecordingApiRunControlStore implements ApiRunControlStore {
  constructor(
    private readonly base: ApiRunControlStore,
    private readonly decisionPlanStore: DecisionPlanStore,
  ) {}

  private async bindPlan(input: ApiRunSubmissionInput): Promise<void> {
    if (!input.intentBinding) return;
    const request = input.run.request;
    if (isConsultationRunRequest(request) && request.decisionNeed !== "QUALIFIED") return;
    if (isConsultationRunRequest(request) && request.context.length > 0) {
      throw new Error("Qualified DecisionPlan cannot include non-authoritative conversation context.");
    }
    await this.decisionPlanStore.bind({
      decisionPlanId: decisionPlanIdForRun(input.run.id),
      runId: input.run.id,
      intentScopeId: input.intentBinding.intentScopeId,
      intentVersionId: input.intentBinding.intentVersionId,
      planningMaterial: structuredClone(
        isConsultationRunRequest(request) ? request.decisionInput! : request,
      ),
    });
  }

  async submitRun(input: ApiRunSubmissionInput): Promise<ApiRunSubmissionResult> {
    await this.bindPlan(input);
    return this.base.submitRun(input);
  }

  async supersedeRun(input: ApiRunSupersessionInput): Promise<ApiRunSupersessionResult> {
    const request = input.supersession.successorRun.request;
    if (isConsultationRunRequest(request) && request.decisionNeed !== "QUALIFIED") {
      return this.base.supersedeRun(input);
    }
    await this.decisionPlanStore.bind({
      decisionPlanId: decisionPlanIdForRun(input.supersession.successorRun.id),
      runId: input.supersession.successorRun.id,
      intentScopeId: input.supersession.successorBinding.intentScopeId,
      intentVersionId: input.supersession.successorBinding.intentVersionId,
      planningMaterial: structuredClone(
        isConsultationRunRequest(request) ? request.decisionInput! : request,
      ),
    });
    return this.base.supersedeRun(input);
  }

  async close(): Promise<void> {
    await this.base.close();
    await this.decisionPlanStore.close();
  }
}
