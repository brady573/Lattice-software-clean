import type { KnowledgeAcquisitionProvider } from "../knowledge/acquisition.js";
import { RelevantKnowledgeAcquisitionProvider } from "../knowledge/investigation.js";
import {
  AlphaDecisionKnowledgeAcquisitionProvider,
} from "../knowledge/npm-decision-acquisition.js";
import { WikimediaKnowledgeAcquisitionProvider } from "../knowledge/wikimedia-acquisition.js";
import type { TruthMode } from "../runtime-config.js";
import {
  createDefaultOfflineTruthPipeline,
  type TruthExecutionPipeline,
} from "./execution-pipeline.js";
import { KnowledgeAcquisitionTruthPipeline } from "./knowledge-acquisition-pipeline.js";
import { AlphaDecisionKnowledgeEvidenceAdmissionPolicy } from "./npm-decision-admission.js";

/**
 * Explicit runtime composition. A1 keeps the existing relevant Wikimedia path;
 * the bounded A3 npm decision slice selects its own source adapter but still
 * enters the same KnowledgeAcquisitionTruthPipeline and V36 admission boundary.
 */
export function createConfiguredTruthPipeline(
  mode: TruthMode,
  provider?: KnowledgeAcquisitionProvider,
): TruthExecutionPipeline {
  if (mode === "v36-offline") return createDefaultOfflineTruthPipeline();

  const fallback = new RelevantKnowledgeAcquisitionProvider(
    provider ?? new WikimediaKnowledgeAcquisitionProvider(),
  );
  const acquisitionProvider = provider
    ? fallback
    : new AlphaDecisionKnowledgeAcquisitionProvider(fallback);
  return new KnowledgeAcquisitionTruthPipeline(
    acquisitionProvider,
    new AlphaDecisionKnowledgeEvidenceAdmissionPolicy(),
  );
}
