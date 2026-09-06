import type { KnowledgeAcquisitionProvider } from "../knowledge/acquisition.js";
import { ConfiguredKnowledgeAcquisitionProvider } from "../knowledge/configured-acquisition.js";
import { RelevantKnowledgeAcquisitionProvider } from "../knowledge/investigation.js";
import type { TruthMode } from "../runtime-config.js";
import { ConfiguredKnowledgeEvidenceAdmissionPolicy } from "./configured-knowledge-admission.js";
import {
  createDefaultOfflineTruthPipeline,
  type TruthExecutionPipeline,
} from "./execution-pipeline.js";
import { KnowledgeAcquisitionTruthPipeline } from "./knowledge-acquisition-pipeline.js";

/**
 * Explicit runtime composition. Injected acquisition remains untrusted and gets
 * no Product source-suitability grant. The canonical built-in live route pairs
 * its bounded source router with the Product-owned suitability admission policy.
 */
export function createConfiguredTruthPipeline(
  mode: TruthMode,
  provider?: KnowledgeAcquisitionProvider,
): TruthExecutionPipeline {
  if (mode === "v36-offline") return createDefaultOfflineTruthPipeline();
  if (provider !== undefined) {
    return new KnowledgeAcquisitionTruthPipeline(
      new RelevantKnowledgeAcquisitionProvider(provider),
    );
  }

  const acquisitionProvider = new ConfiguredKnowledgeAcquisitionProvider();
  return new KnowledgeAcquisitionTruthPipeline(
    new RelevantKnowledgeAcquisitionProvider(acquisitionProvider),
    new ConfiguredKnowledgeEvidenceAdmissionPolicy(),
  );
}
