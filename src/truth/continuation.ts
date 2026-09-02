import { createHash } from "node:crypto";
import {
  admitResearchResult,
  FailClosedResearchEvidenceAdmissionPolicy,
  validateResearchResult,
  type ResearchEvidenceAdmissionPolicy,
  type ResearchRequest,
  type ResearchResult,
  type TruthResearchResult,
} from "./pipeline.js";
import {
  assertTruthSnapshotIntegrity,
  stableStructuredJson,
  type TruthSnapshot,
} from "./snapshot.js";
import type { ResearchPurpose } from "./types.js";

export interface V36ResearchRequest {
  id: string;
  runId: string;
  claimId: string;
  parentRequestId: string | null;
  purpose: ResearchPurpose;
  query: string;
  serialRound: number;
}

export interface V36OperationalFailure {
  code: string;
  message: string;
  retryable: boolean;
}

export type V36ResearchExecutionResult =
  | {
      requestId: string;
      runId: string;
      outcome: "SUCCEEDED";
      result: ResearchResult;
      operationalFailure: null;
    }
  | {
      requestId: string;
      runId: string;
      outcome: "OPERATIONAL_FAILURE";
      result: null;
      operationalFailure: V36OperationalFailure;
    };

/** Runtime/provider results remain opaque until V36 validates them. */
export type V36UntrustedResearchExecutionResult =
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

export interface V36ResearchCheckpoint {
  version: 1;
  runId: string;
  round: number;
  executionContractId: string;
  snapshot: TruthSnapshot;
  researchRequests: readonly V36ResearchRequest[];
  checkpointHash: string;
}

export interface V36NeedsResearch {
  kind: "NEEDS_RESEARCH";
  checkpoint: V36ResearchCheckpoint;
  researchRequests: readonly V36ResearchRequest[];
}

export interface V36PreparedResume {
  checkpoint: V36ResearchCheckpoint;
  results: readonly V36ResearchExecutionResult[];
}

export type V36AdmittedResearchResult =
  | {
      requestId: string;
      runId: string;
      outcome: "SUCCEEDED";
      truthResult: TruthResearchResult;
      operationalFailure: null;
    }
  | {
      requestId: string;
      runId: string;
      outcome: "OPERATIONAL_FAILURE";
      truthResult: null;
      operationalFailure: V36OperationalFailure;
    };

export interface V36AdmittedResume {
  checkpoint: V36ResearchCheckpoint;
  results: readonly V36AdmittedResearchResult[];
}

function requireNonBlank(value: string, label: string): void {
  if (value.trim().length === 0) throw new Error(`${label} must not be blank.`);
}

function checkpointPayload(
  checkpoint: Omit<V36ResearchCheckpoint, "checkpointHash">,
): unknown {
  return {
    version: checkpoint.version,
    runId: checkpoint.runId,
    round: checkpoint.round,
    executionContractId: checkpoint.executionContractId,
    snapshot: checkpoint.snapshot,
    researchRequests: checkpoint.researchRequests,
  };
}

function checkpointHash(checkpoint: Omit<V36ResearchCheckpoint, "checkpointHash">): string {
  return createHash("sha256")
    .update(stableStructuredJson(checkpointPayload(checkpoint)))
    .digest("hex");
}

function cloneRequest(request: V36ResearchRequest): V36ResearchRequest {
  return structuredClone(request);
}

function assertResearchRequests(
  snapshot: TruthSnapshot,
  requests: readonly V36ResearchRequest[],
): void {
  if (requests.length === 0) {
    throw new Error("V36 NEEDS_RESEARCH must contain at least one research request.");
  }

  const claimIds = new Set(snapshot.bundle.claims.map((claim) => claim.id));
  const requestIds = new Set<string>();
  for (const request of requests) {
    requireNonBlank(request.id, "V36 research request id");
    requireNonBlank(request.runId, "V36 research request runId");
    requireNonBlank(request.claimId, "V36 research request claimId");
    requireNonBlank(request.query, "V36 research request query");
    if (request.runId !== snapshot.runId) {
      throw new Error("V36 research request Run scope does not match checkpoint truth state.");
    }
    if (!claimIds.has(request.claimId)) {
      throw new Error(`V36 research request references unknown claim: ${request.claimId}`);
    }
    if (!Number.isSafeInteger(request.serialRound) || request.serialRound <= 0) {
      throw new Error("V36 research request serialRound must be a positive integer.");
    }
    if (requestIds.has(request.id)) {
      throw new Error(`V36 research request id is duplicated: ${request.id}`);
    }
    requestIds.add(request.id);
  }

  for (const request of requests) {
    if (request.parentRequestId !== null && !requestIds.has(request.parentRequestId)) {
      const priorQuestion = snapshot.bundle.researchQuestions.some((item) => item.id === request.parentRequestId);
      if (!priorQuestion) {
        throw new Error(
          `V36 research request references unknown parent request: ${request.parentRequestId}`,
        );
      }
    }
    if (request.parentRequestId === request.id) {
      throw new Error("V36 research request cannot depend on itself as parent.");
    }
  }
}

export function createV36NeedsResearch(
  snapshot: TruthSnapshot,
  researchRequests: readonly V36ResearchRequest[],
  round: number,
): V36NeedsResearch {
  assertTruthSnapshotIntegrity(snapshot);
  if (!Number.isSafeInteger(round) || round <= 0) {
    throw new Error("V36 continuation round must be a positive integer.");
  }

  const snapshotCopy = structuredClone(snapshot);
  const requestCopies = researchRequests.map(cloneRequest);
  assertResearchRequests(snapshotCopy, requestCopies);
  const withoutHash: Omit<V36ResearchCheckpoint, "checkpointHash"> = {
    version: 1,
    runId: snapshotCopy.runId,
    round,
    executionContractId: snapshotCopy.executionContractId,
    snapshot: snapshotCopy,
    researchRequests: requestCopies,
  };
  const checkpoint: V36ResearchCheckpoint = {
    ...withoutHash,
    checkpointHash: checkpointHash(withoutHash),
  };
  return {
    kind: "NEEDS_RESEARCH",
    checkpoint,
    researchRequests: checkpoint.researchRequests,
  };
}

export function assertV36ResearchCheckpointIntegrity(checkpoint: V36ResearchCheckpoint): void {
  if (checkpoint.version !== 1) throw new Error("Unsupported V36 research checkpoint version.");
  requireNonBlank(checkpoint.runId, "V36 research checkpoint runId");
  requireNonBlank(checkpoint.executionContractId, "V36 research checkpoint executionContractId");
  if (!Number.isSafeInteger(checkpoint.round) || checkpoint.round <= 0) {
    throw new Error("V36 continuation round must be a positive integer.");
  }
  if (!/^[a-f0-9]{64}$/u.test(checkpoint.checkpointHash)) {
    throw new Error("V36 research checkpoint hash is malformed.");
  }

  assertTruthSnapshotIntegrity(checkpoint.snapshot);
  if (checkpoint.runId !== checkpoint.snapshot.runId) {
    throw new Error("V36 research checkpoint Run scope does not match its truth state.");
  }
  if (checkpoint.executionContractId !== checkpoint.snapshot.executionContractId) {
    throw new Error("V36 research checkpoint execution contract does not match its truth state.");
  }
  assertResearchRequests(checkpoint.snapshot, checkpoint.researchRequests);

  const withoutHash: Omit<V36ResearchCheckpoint, "checkpointHash"> = {
    version: checkpoint.version,
    runId: checkpoint.runId,
    round: checkpoint.round,
    executionContractId: checkpoint.executionContractId,
    snapshot: checkpoint.snapshot,
    researchRequests: checkpoint.researchRequests,
  };
  if (checkpointHash(withoutHash) !== checkpoint.checkpointHash) {
    throw new Error("V36 research checkpoint hash does not match its complete continuation state.");
  }
}

function assertOperationalFailure(failure: V36OperationalFailure): void {
  requireNonBlank(failure.code, "V36 operational failure code");
  requireNonBlank(failure.message, "V36 operational failure message");
}

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
 * Validate and detach the durable execution-result envelope before it re-enters
 * protected V36 epistemic computation. This performs no admission or verdict.
 */
export function prepareV36Resume(
  checkpoint: V36ResearchCheckpoint,
  results: readonly V36UntrustedResearchExecutionResult[],
): V36PreparedResume {
  assertV36ResearchCheckpointIntegrity(checkpoint);

  const requests = new Map(checkpoint.researchRequests.map((request) => [request.id, request] as const));
  const resultIds = new Set<string>();
  const validated: V36ResearchExecutionResult[] = [];
  for (const result of results) {
    requireNonBlank(result.requestId, "V36 research result requestId");
    requireNonBlank(result.runId, "V36 research result runId");
    if (result.runId !== checkpoint.runId) {
      throw new Error("V36 research result Run scope does not match checkpoint.");
    }
    const request = requests.get(result.requestId);
    if (!request) {
      throw new Error(`V36 resume received an unrequested result: ${result.requestId}`);
    }
    if (resultIds.has(result.requestId)) {
      throw new Error(`V36 resume received duplicate results for request: ${result.requestId}`);
    }
    resultIds.add(result.requestId);

    if (result.outcome === "SUCCEEDED") {
      if (result.operationalFailure !== null) {
        throw new Error("Successful V36 research result cannot contain an operational failure.");
      }
      validated.push({
        requestId: result.requestId,
        runId: result.runId,
        outcome: "SUCCEEDED",
        result: validateResearchResult(toResearchRequest(request), result.result),
        operationalFailure: null,
      });
    } else {
      if (result.result !== null) {
        throw new Error("Operationally failed V36 research result cannot contain provider result data.");
      }
      assertOperationalFailure(result.operationalFailure);
      validated.push(structuredClone(result));
    }
  }

  if (resultIds.size !== requests.size) {
    const missing = [...requests.keys()].filter((requestId) => !resultIds.has(requestId));
    throw new Error(`V36 resume is missing execution results for: ${missing.join(", ")}`);
  }

  return {
    checkpoint: structuredClone(checkpoint),
    results: validated,
  };
}

/**
 * Re-enter successful durable execution results through the V36-owned evidence
 * admission boundary. This step still makes no sufficiency, contradiction,
 * further-round, or authoritative truth-state decision.
 */
export function admitV36ResumeResults(
  checkpoint: V36ResearchCheckpoint,
  results: readonly V36UntrustedResearchExecutionResult[],
  admissionPolicy: ResearchEvidenceAdmissionPolicy = new FailClosedResearchEvidenceAdmissionPolicy(),
): V36AdmittedResume {
  const prepared = prepareV36Resume(checkpoint, results);
  const requests = new Map(
    prepared.checkpoint.researchRequests.map((request) => [request.id, request] as const),
  );

  const admittedResults = prepared.results.map<V36AdmittedResearchResult>((result) => {
    if (result.outcome === "OPERATIONAL_FAILURE") {
      return {
        requestId: result.requestId,
        runId: result.runId,
        outcome: "OPERATIONAL_FAILURE",
        truthResult: null,
        operationalFailure: structuredClone(result.operationalFailure),
      };
    }

    const request = requests.get(result.requestId);
    if (request === undefined) {
      throw new Error(`V36 admission lost its bound research request: ${result.requestId}`);
    }
    return {
      requestId: result.requestId,
      runId: result.runId,
      outcome: "SUCCEEDED",
      truthResult: admitResearchResult(toResearchRequest(request), result.result, admissionPolicy),
      operationalFailure: null,
    };
  });

  return {
    checkpoint: structuredClone(prepared.checkpoint),
    results: admittedResults,
  };
}
