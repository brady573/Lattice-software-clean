import type { KnowledgeAcquisitionProvider } from "../knowledge/acquisition.js";
import {
  RelevantKnowledgeAcquisitionProvider,
  type KnowledgeInvestigator,
} from "../knowledge/investigation.js";
import {
  AlphaDecisionKnowledgeAcquisitionProvider,
} from "../knowledge/npm-decision-acquisition.js";
import { WikimediaKnowledgeAcquisitionProvider } from "../knowledge/wikimedia-acquisition.js";
import { resolveRuntimeConfig, type RuntimeConfig, type TruthMode } from "../runtime-config.js";
import { createConfiguredSolandraKnowledgeInvestigator } from "../solandra/knowledge-investigator.js";
import {
  createDefaultOfflineTruthPipeline,
  type TruthExecutionPipeline,
} from "./execution-pipeline.js";
import { KnowledgeAcquisitionTruthPipeline } from "./knowledge-acquisition-pipeline.js";
import { AlphaDecisionKnowledgeEvidenceAdmissionPolicy } from "./npm-decision-admission.js";

/**
 * Explicit runtime composition. Live general Knowledge uses Solandra for
 * non-authoritative investigation planning and semantic responsiveness before
 * candidate information enters the unchanged V36 admission boundary.
 *
 * Canonical v36-live composition requires an actually configured Solandra
 * investigator at composition time. An explicitly injected acquisition
 * provider remains an integration/test seam and does not advertise canonical
 * live general-Knowledge capability.
 */
export function createConfiguredTruthPipeline(
  mode: TruthMode,
  provider?: KnowledgeAcquisitionProvider,
  investigator?: KnowledgeInvestigator,
  runtimeConfig: RuntimeConfig = resolveRuntimeConfig(),
): TruthExecutionPipeline {
  if (mode === "v36-offline") return createDefaultOfflineTruthPipeline();

  const semanticInvestigator = investigator
    ?? (provider === undefined
      ? createConfiguredSolandraKnowledgeInvestigator(runtimeConfig)
      : undefined);

  if (provider === undefined && semanticInvestigator === undefined) {
    throw new Error(
      "LATTICE_TRUTH_MODE=v36-live requires configured Solandra Knowledge investigation via LATTICE_SOLANDRA_COGNITION_ROUTE=groq-gpt-oss-120b or a development local model provider.",
    );
  }

  const rawFallback = provider ?? new WikimediaKnowledgeAcquisitionProvider();
  const fallback = semanticInvestigator
    ? new RelevantKnowledgeAcquisitionProvider(rawFallback, semanticInvestigator)
    : rawFallback;
  const acquisitionProvider = provider
    ? fallback
    : new AlphaDecisionKnowledgeAcquisitionProvider(fallback);
  return new KnowledgeAcquisitionTruthPipeline(
    acquisitionProvider,
    new AlphaDecisionKnowledgeEvidenceAdmissionPolicy(),
  );
}
