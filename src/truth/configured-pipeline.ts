import type { KnowledgeAcquisitionProvider } from "../knowledge/acquisition.js";
import {
  RelevantKnowledgeAcquisitionProvider,
  type KnowledgeInvestigator,
} from "../knowledge/investigation.js";
import {
  AlphaDecisionKnowledgeAcquisitionProvider,
} from "../knowledge/npm-decision-acquisition.js";
import { WikimediaKnowledgeAcquisitionProvider } from "../knowledge/wikimedia-acquisition.js";
import { resolveRuntimeConfig, type TruthMode } from "../runtime-config.js";
import { createConfiguredSolandraKnowledgeInvestigator } from "../solandra/knowledge-investigator.js";
import {
  createDefaultOfflineTruthPipeline,
  type TruthExecutionPipeline,
} from "./execution-pipeline.js";
import { KnowledgeAcquisitionTruthPipeline } from "./knowledge-acquisition-pipeline.js";
import { AlphaDecisionKnowledgeEvidenceAdmissionPolicy } from "./npm-decision-admission.js";

const unavailableGeneralKnowledgeProvider: KnowledgeAcquisitionProvider = Object.freeze({
  kind: "solandra-investigation-unavailable",
  async acquire() {
    throw new Error("Live general Knowledge requires configured Solandra semantic investigation.");
  },
});

/**
 * Explicit runtime composition. Live general Knowledge uses Solandra for
 * non-authoritative investigation planning and semantic responsiveness before
 * candidate information enters the unchanged V36 admission boundary.
 *
 * Runtime surfaces that do not invoke general Knowledge may still be composed
 * without a Solandra investigator. If general Knowledge is later requested,
 * that path fails closed rather than falling back to deterministic semantics.
 * An explicitly injected acquisition provider without an investigator remains
 * an integration/test seam rather than the canonical live Product composition.
 */
export function createConfiguredTruthPipeline(
  mode: TruthMode,
  provider?: KnowledgeAcquisitionProvider,
  investigator?: KnowledgeInvestigator,
): TruthExecutionPipeline {
  if (mode === "v36-offline") return createDefaultOfflineTruthPipeline();

  const semanticInvestigator = investigator
    ?? (provider === undefined
      ? createConfiguredSolandraKnowledgeInvestigator(resolveRuntimeConfig())
      : undefined);

  const rawFallback = provider
    ?? (semanticInvestigator === undefined
      ? unavailableGeneralKnowledgeProvider
      : new WikimediaKnowledgeAcquisitionProvider());
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
