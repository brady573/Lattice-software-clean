import type {
  ApiRunControlStore,
  ApiRunSubmissionInput,
  ApiRunSubmissionResult,
  ApiRunSupersessionInput,
  ApiRunSupersessionResult,
} from "../api-control-store.js";
import { isConsultationRunRequest, type LatticeRun } from "../domain.js";
import {
  decisionPlanIdForRun,
  type DecisionPlanningMaterial,
  type DecisionPlanStore,
  type DurableDecisionPlan,
} from "./decision-plan-store.js";
import type { RunIntentBindingInput } from "./run-binding.js";

export function decisionPlanBindingForRun(
  run: Pick<LatticeRun, "id" | "request">,
  intentBinding: RunIntentBindingInput | undefined,
): Omit<DurableDecisionPlan<DecisionPlanningMaterial>, "boundAt"> | undefined {
  if (!intentBinding) return undefined;
  const request = run.request;
  if (isConsultationRunRequest(request) && request.decisionNeed !== "QUALIFIED") return undefined;
  return {
    decisionPlanId: decisionPlanIdForRun(run.id),
    runId: run.id,
    intentScopeId: intentBinding.intentScopeId,
    intentVersionId: intentBinding.intentVersionId,
    planningMaterial: structuredClone(
      isConsultationRunRequest(request) ? request.decisionInput! : request,
    ),
  };
}

export class DecisionPlanRecordingApiRunControlStore implements ApiRunControlStore {
  constructor(
    private readonly base: ApiRunControlStore,
    private readonly decisionPlanStore: DecisionPlanStore,
  ) {}

  private async bindPlan(input: ApiRunSubmissionInput): Promise<void> {
    const binding = decisionPlanBindingForRun(input.run, input.intentBinding);
    if (binding) await this.decisionPlanStore.bind(binding);
  }

  async submitRun(input: ApiRunSubmissionInput): Promise<ApiRunSubmissionResult> {
    const result = await this.base.submitRun(input);
    if (result.outcome === "created" || result.outcome === "existing") {
      await this.bindPlan(input);
    }
    return result;
  }

  async supersedeRun(input: ApiRunSupersessionInput): Promise<ApiRunSupersessionResult> {
    const result = await this.base.supersedeRun(input);
    if (result.outcome !== "superseded" && result.outcome !== "replayed") return result;

    const binding = decisionPlanBindingForRun(
      input.supersession.successorRun,
      input.supersession.successorBinding,
    );
    if (binding) await this.decisionPlanStore.bind(binding);
    return result;
  }

  async close(): Promise<void> {
    await this.base.close();
    await this.decisionPlanStore.close();
  }
}
