import type { Candidate, Evidence, EvidenceValue } from "../domain.js";
import type {
  SourceEdgeType,
  TruthClaimProfile,
  TruthEvidenceProfile,
  TruthResearchProfile,
} from "./types.js";

export interface FixtureObservation {
  id: string;
  value: EvidenceValue;
  sourceId: string;
  sourceLabel: string;
  admitted?: boolean;
}

export interface FixtureSourceEdge {
  fromSourceId: string;
  toSourceId: string;
  edgeType: SourceEdgeType;
  confidence: number;
  contentSimilarity?: number | null;
}

/** Deterministic V36 input used only by offline validation compositions. */
export interface FixtureDataset {
  /** External observations for V36; no candidate or criterion shape is required. */
  evidence?: FixtureObservation[];
  truthClaims: TruthClaimProfile[];
  truthEvidence: TruthEvidenceProfile[];
  truthSourceEdges?: FixtureSourceEdge[];
  truthResearch?: TruthResearchProfile[];
}

export type DecisionFixtureDataset = Omit<FixtureDataset, "evidence"> & {
  candidates: Candidate[];
  evidence: Evidence[];
};
