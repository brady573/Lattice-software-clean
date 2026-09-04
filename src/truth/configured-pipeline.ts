import type { KnowledgeAcquisitionProvider } from "../knowledge/acquisition.js";
import { WikimediaKnowledgeAcquisitionProvider } from "../knowledge/wikimedia-acquisition.js";
import type { TruthMode } from "../runtime-config.js";
import {
  createDefaultOfflineTruthPipeline,
  type TruthExecutionPipeline,
} from "./execution-pipeline.js";
import { KnowledgeAcquisitionTruthPipeline } from "./knowledge-acquisition-pipeline.js";

/** Explicit runtime composition; the selected acquisition adapter remains replaceable. */
export function createConfiguredTruthPipeline(
  mode: TruthMode,
  provider?: KnowledgeAcquisitionProvider,
): TruthExecutionPipeline {
  if (mode === "v36-offline") return createDefaultOfflineTruthPipeline();
  return new KnowledgeAcquisitionTruthPipeline(
    provider ?? new WikimediaKnowledgeAcquisitionProvider(),
  );
}
