import {
  canonicalModelRequestIdentity,
  validateCanonicalModelRequest,
} from "./canonical.js";
import { ModelProviderError } from "./errors.js";
import type { ModelProvider } from "./provider.js";
import type {
  CanonicalModelRequest,
  ModelCallContext,
  ModelProviderResult,
} from "./types.js";

export interface DeterministicModelFixture {
  readonly id: string;
  readonly request: CanonicalModelRequest;
  readonly response: unknown;
}

export class DeterministicFixtureModelProvider implements ModelProvider {
  readonly kind = "offline-fixture";
  private readonly fixtures: ReadonlyMap<string, DeterministicModelFixture>;

  constructor(fixtures: readonly DeterministicModelFixture[]) {
    const byIdentity = new Map<string, DeterministicModelFixture>();
    for (const fixture of fixtures) {
      if (fixture.id.trim().length === 0) {
        throw new Error("Model fixture id must be non-empty.");
      }
      const request = validateCanonicalModelRequest(fixture.request);
      const identity = canonicalModelRequestIdentity(request);
      if (byIdentity.has(identity)) {
        throw new Error(`Duplicate model fixture request identity: ${identity}`);
      }
      byIdentity.set(identity, Object.freeze({
        id: fixture.id,
        request,
        response: structuredClone(fixture.response),
      }));
    }
    this.fixtures = byIdentity;
  }

  async generate(
    _request: CanonicalModelRequest,
    context: ModelCallContext,
  ): Promise<ModelProviderResult> {
    if (context.signal.aborted) {
      throw new ModelProviderError("cancelled", "Model fixture call was cancelled.");
    }
    const fixture = this.fixtures.get(context.requestIdentity);
    if (fixture === undefined) {
      throw new ModelProviderError(
        "fixture_not_found",
        "No deterministic model fixture exists for this canonical request.",
      );
    }
    return {
      response: structuredClone(fixture.response),
      metadata: {
        fixtureId: fixture.id,
      },
    };
  }
}
