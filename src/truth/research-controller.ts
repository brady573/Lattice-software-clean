import { recoverIndependentCorroboration, corroborationState } from "./corroboration.js";
import { runSelectiveFalsification, shouldRouteFalsification } from "./falsification.js";
import { executeEvidencePlan, type EvidenceTask } from "./orchestrator.js";
import type { TruthResearchProvider } from "./pipeline.js";
import { mergeClaimEvidenceStrict } from "./state-merge.js";
import type { ClaimEvidence, CompiledClaim, ResearchQuestion, SourceArtifact, SourceEdge } from "./types.js";

export interface PrototypeResearchResult {
  evidence: ClaimEvidence[];
  artifacts: SourceArtifact[];
  edges: SourceEdge[];
  researchQuestions: ResearchQuestion[];
  serialCriticalPathRounds: number;
}

type BranchResult = {
  evidence: ClaimEvidence[];
  artifacts: SourceArtifact[];
  edges: SourceEdge[];
  questions: ResearchQuestion[];
  serialRounds: number;
};

function mergeArtifacts(groups: SourceArtifact[][]): SourceArtifact[] {
  const map = new Map<string, SourceArtifact>();
  for (const group of groups) for (const item of group) map.set(item.artifactHash, item);
  return [...map.values()];
}

function mergeEdges(groups: SourceEdge[][]): SourceEdge[] {
  const map = new Map<string, SourceEdge>();
  for (const group of groups) for (const item of group) map.set(item.id, item);
  return [...map.values()];
}

export async function runPrototypeResearch(
  claim: CompiledClaim,
  initialEvidence: ClaimEvidence[],
  provider: TruthResearchProvider,
  maxCorroborationProbes = 2,
): Promise<PrototypeResearchResult> {
  const tasks: EvidenceTask<BranchResult>[] = [];

  if (shouldRouteFalsification(claim, initialEvidence)) {
    tasks.push({
      id: "falsification",
      dependsOn: [],
      execute: async () => {
        const result = await runSelectiveFalsification(claim, initialEvidence, provider, 1);
        return {
          evidence: result.evidence,
          artifacts: result.research.flatMap((item) => item.artifacts),
          edges: result.research.flatMap((item) => item.edges),
          questions: result.requests.map((request) => ({
            id: request.id,
            runId: request.runId,
            claimId: request.claimId,
            parentQuestionId: request.parentQuestionId,
            purpose: request.purpose,
            query: request.query,
            serialRound: request.serialRound,
          })),
          serialRounds: result.serialRounds,
        };
      },
    });
  }

  if (!corroborationState(claim, initialEvidence, 0, maxCorroborationProbes).complete) {
    tasks.push({
      id: "corroboration",
      dependsOn: [],
      execute: async () => {
        const result = await recoverIndependentCorroboration(
          claim,
          initialEvidence,
          provider,
          maxCorroborationProbes,
          1,
        );
        return {
          evidence: result.evidence,
          artifacts: result.research.flatMap((item) => item.artifacts),
          edges: result.research.flatMap((item) => item.edges),
          questions: result.requests.map((request) => ({
            id: request.id,
            runId: request.runId,
            claimId: request.claimId,
            parentQuestionId: request.parentQuestionId,
            purpose: request.purpose,
            query: request.query,
            serialRound: request.serialRound,
          })),
          serialRounds: result.serialRounds,
        };
      },
    });
  }

  if (tasks.length === 0) {
    return {
      evidence: [...initialEvidence],
      artifacts: [],
      edges: [],
      researchQuestions: [],
      serialCriticalPathRounds: 0,
    };
  }

  const plan = await executeEvidencePlan(tasks);
  const branches = [...plan.results.values()].map((item) => item.value);
  const serialCriticalPathRounds = Math.max(...branches.map((branch) => branch.serialRounds), 0);
  return {
    evidence: mergeClaimEvidenceStrict(
      [initialEvidence, ...branches.map((branch) => branch.evidence)],
      { allowDispositionUpdates: true },
    ),
    artifacts: mergeArtifacts(branches.map((branch) => branch.artifacts)),
    edges: mergeEdges(branches.map((branch) => branch.edges)),
    researchQuestions: branches.flatMap((branch) => branch.questions),
    serialCriticalPathRounds,
  };
}
