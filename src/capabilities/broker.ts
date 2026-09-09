import type { CapabilityAuthorizationStore, CapabilityInvocationEvidence } from "./authorization-store.js";
import type { CapabilityContract, CapabilityInvocationResult } from "./contracts.js";

export class CapabilityUnavailableError extends Error {
  constructor(readonly capabilityId: string) {
    super(`Capability ${capabilityId} is unavailable.`);
    this.name = "CapabilityUnavailableError";
  }
}

export class CapabilityNotAuthorizedError extends Error {
  constructor(readonly capabilityId: string) {
    super(`Capability ${capabilityId} is not authorized for this subject.`);
    this.name = "CapabilityNotAuthorizedError";
  }
}

export class CapabilityRevokedError extends Error {
  constructor(readonly capabilityId: string) {
    super(`Capability ${capabilityId} authorization changed during invocation; result was discarded.`);
    this.name = "CapabilityRevokedError";
  }
}

function now(): string {
  return new Date().toISOString();
}

function capabilityFailureCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.trim()) return code.trim().slice(0, 120);
  }
  if (error instanceof Error && error.name.trim()) return error.name.trim().slice(0, 120);
  return "CAPABILITY_FAILURE";
}

export class CapabilityBroker {
  private readonly capabilities = new Map<string, CapabilityContract<unknown, unknown>>();

  constructor(private readonly authorizations: CapabilityAuthorizationStore) {}

  register<Input, Output>(capability: CapabilityContract<Input, Output>): void {
    if (this.capabilities.has(capability.id)) throw new Error(`Capability ${capability.id} is already registered.`);
    this.capabilities.set(capability.id, capability as CapabilityContract<unknown, unknown>);
  }

  has(capabilityId: string): boolean {
    return this.capabilities.has(capabilityId);
  }

  async stateFor(subjectId: string, capabilityId: string) {
    const grant = await this.authorizations.get(subjectId, capabilityId);
    return Object.freeze({
      capabilityId,
      available: this.capabilities.has(capabilityId),
      status: this.capabilities.has(capabilityId) ? grant.status : "UNAVAILABLE" as const,
      authorized: this.capabilities.has(capabilityId) && grant.status === "CONNECTED",
      version: grant.version,
      updatedAt: grant.updatedAt,
      lastInvocation: grant.lastInvocation === null ? null : structuredClone(grant.lastInvocation),
    });
  }

  async connect(subjectId: string, capabilityId: string) {
    if (!this.capabilities.has(capabilityId)) throw new CapabilityUnavailableError(capabilityId);
    return await this.authorizations.connect(subjectId, capabilityId);
  }

  async disconnect(subjectId: string, capabilityId: string) {
    return await this.authorizations.disconnect(subjectId, capabilityId);
  }

  async invoke<Input, Output>(input: {
    subjectId: string;
    capabilityId: string;
    requestId: string;
    purpose: string;
    payload: Input;
  }): Promise<CapabilityInvocationResult<Output>> {
    const capability = this.capabilities.get(input.capabilityId) as CapabilityContract<Input, Output> | undefined;
    if (!capability) throw new CapabilityUnavailableError(input.capabilityId);
    const before = await this.authorizations.get(input.subjectId, input.capabilityId);
    if (before.status !== "CONNECTED") throw new CapabilityNotAuthorizedError(input.capabilityId);

    try {
      const executed = await capability.invoke(input.payload, {
        subjectId: input.subjectId,
        requestId: input.requestId,
        authorizationVersion: before.version,
        purpose: input.purpose,
        requester: "SOLANDRA",
      });
      const evidence: CapabilityInvocationEvidence = {
        requestId: input.requestId,
        purpose: input.purpose,
        outcome: "SUCCEEDED",
        recordedAt: now(),
        provenance: executed.provenance,
        failureCode: null,
      };
      const finalized = await this.authorizations.finalizeInvocation(
        input.subjectId,
        input.capabilityId,
        before.version,
        evidence,
      );
      if (!finalized) throw new CapabilityRevokedError(input.capabilityId);
      return Object.freeze({
        capabilityId: capability.id,
        purpose: input.purpose,
        requester: "SOLANDRA",
        effect: capability.effect,
        trustHandling: capability.trustHandling,
        authorizationVersion: before.version,
        output: executed.output,
        provenance: executed.provenance,
      });
    } catch (error) {
      if (error instanceof CapabilityRevokedError) throw error;
      const evidence: CapabilityInvocationEvidence = {
        requestId: input.requestId,
        purpose: input.purpose,
        outcome: "CAPABILITY_FAILURE",
        recordedAt: now(),
        provenance: null,
        failureCode: capabilityFailureCode(error),
      };
      await this.authorizations.recordInvocation(input.subjectId, input.capabilityId, evidence);
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.authorizations.close();
  }
}
