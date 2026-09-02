import type {
  CanonicalModelRequest,
  ModelCallContext,
  ModelProviderResult,
} from "./types.js";

export interface ModelProvider {
  readonly kind: string;
  generate(
    request: CanonicalModelRequest,
    context: ModelCallContext,
  ): Promise<ModelProviderResult>;
}
