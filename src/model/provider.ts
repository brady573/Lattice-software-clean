import type {
  CanonicalModelRequest,
  ModelCallContext,
  ModelProviderResult,
} from "./types.js";

export interface ModelProvider {
  readonly kind: string;
  readonly structuredOutputCapability?: "json_schema";
  generate(
    request: CanonicalModelRequest,
    context: ModelCallContext,
  ): Promise<ModelProviderResult>;
}
