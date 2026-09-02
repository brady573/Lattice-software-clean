import type { FastifyInstance } from "fastify";
import type { DecisionPlanStore } from "./decision-plan-store.js";

export function registerDecisionPlanApi(app: FastifyInstance, options: { decisionPlanStore: DecisionPlanStore }): void {
  app.get<{ Params: { runId: string } }>("/api/v1/runs/:runId/decision-plan", async (request, reply) => {
    const runId = request.params.runId.trim();
    if (!runId || runId.length > 200) return reply.status(400).send({ error: "INVALID_RUN_ID" });
    const plan = await options.decisionPlanStore.getByRunId(runId);
    if (!plan) return reply.status(404).send({ error: "DECISION_PLAN_NOT_FOUND" });
    return reply.status(200).send({ decisionPlan: plan });
  });
}
