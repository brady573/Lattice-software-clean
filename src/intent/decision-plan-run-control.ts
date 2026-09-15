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
    // The Run is the primary durable operation. A qualified decision response
    // is not acknowledged until its exact DecisionPlan binding is present.
    // If plan persistence fails after the Run commits, replay reconnects to the
    // same immutable Run and idempotently repairs the binding before returning.
    const result = await this.base.submitRun(input);
    if (result.outcome === "created" || result.outcome === "existing") {
      await this.bindPlan(input);
    }
    return result;
  }

  async supersedeRun(input: ApiRunSupersessionInput): Promise<ApiRunSupersessionResult> {
    const result = await this.base.supersedeRun(input);
    if (result.outcome !== "superseded" && result.outcome !== "replayed") return result;

    const request = input.supersession.successorRun.request;
    if (isConsultationRunRequest(request) && request.decisionNeed !== "QUALIFIED") return result;
    await this.decisionPlanStore.bind({
      decisionPlanId: decisionPlanIdForRun(input.supersession.successorRun.id),
      runId: input.supersession.successorRun.id,
      intentScopeId: input.supersession.successorBinding.intentScopeId,
      intentVersionId: input.supersession.successorBinding.intentVersionId,
      planningMaterial: structuredClone(
        isConsultationRunRequest(request) ? request.decisionInput! : request,
      ),
    });
    return result;
  }

  async close(): Promise<void> {
    await this.base.close();
    await this.decisionPlanStore.close();
  }
}
