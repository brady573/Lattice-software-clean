import type { Candidate, Evidence } from "../domain.js";
import type {
  SourceEdgeType,
  TruthClaimProfile,
  TruthEvidenceProfile,
  TruthResearchProfile,
} from "./types.js";

export interface FixtureSourceEdge {
  fromSourceId: string;
  toSourceId: string;
  edgeType: SourceEdgeType;
  confidence: number;
  contentSimilarity?: number | null;
}

/** Deterministic V36 input used only by offline validation compositions. */
export interface FixtureDataset {
  candidates: Candidate[];
  evidence: Evidence[];
  truthClaims: TruthClaimProfile[];
  truthEvidence: TruthEvidenceProfile[];
  truthSourceEdges?: FixtureSourceEdge[];
  truthResearch?: TruthResearchProfile[];
}
