import {
  prepareV36Resume,
  type V36OperationalFailure,
  type V36PreparedResume,
  type V36ResearchCheckpoint,
  type V36ResearchExecutionResult,
  type V36ResearchRequest,
} from "./continuation.js";
import {
  validateResearchResult,
  type ResearchRequest,
  type ResearchResult,
} from "./pipeline.js";
/**
 * Execution Runtime handoff shape before protected V36 re-entry. Successful
 * payloads deliberately remain opaque here; this contract grants no truth
 * authority and mirrors the durable bridge's operational result envelope.
 */
export type V36RuntimeExecutionResult =
  | {
      requestId: string;
      runId: string;
      outcome: "SUCCEEDED";
      result: unknown;
      operationalFailure: null;
    }
  | {
      requestId: string;
      runId: string;
      outcome: "OPERATIONAL_FAILURE";
      result: null;
      operationalFailure: V36OperationalFailure;
    };

function toResearchRequest(request: V36ResearchRequest): ResearchRequest {
  return {
    id: request.id,
    runId: request.runId,
    claimId: request.claimId,
    parentQuestionId: request.parentRequestId,
    purpose: request.purpose,
    query: request.query,
    serialRound: request.serialRound,
  };
}

/**
 * Delegate opaque runtime/provider payloads to the canonical structural parser.
 * This establishes structure and Run scope only; it grants no evidence admission,
 * verification, provenance authority, or truth state.
 */
export function parseV36RuntimeResearchResult(
  request: V36ResearchRequest,
  value: unknown,
): ResearchResult {
  return validateResearchResult(toResearchRequest(request), value);
}

/**
 * Fail-closed boundary from durable operational results into the canonical V36
 * continuation envelope. This performs no evidence admission or truth verdict.
 */
export function prepareV36RuntimeResume(
  checkpoint: V36ResearchCheckpoint,
  results: readonly V36RuntimeExecutionResult[],
): V36PreparedResume {
  const requestById = new Map(checkpoint.researchRequests.map((request) => [request.id, request] as const));
  const canonical = results.map<V36ResearchExecutionResult>((result) => {
    if (result.outcome === "OPERATIONAL_FAILURE") {
      return structuredClone(result);
    }
    const request = requestById.get(result.requestId);
    if (!request) {
      throw new Error(`V36 runtime handoff received an unrequested result: ${result.requestId}`);
    }
    return {
      requestId: result.requestId,
      runId: result.runId,
      outcome: "SUCCEEDED",
      result: parseV36RuntimeResearchResult(request, result.result),
      operationalFailure: null,
    };
  });
  return prepareV36Resume(checkpoint, canonical);
}
