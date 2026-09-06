import {
  ALPHA_NPM_RUNTIME_DEPENDENCY_CRITERION_ID,
  parseAlphaNpmDecisionSemantics,
} from "../decision/alpha-decision-capability.js";
import type {
  KnowledgeAcquisitionProvider,
  KnowledgeAcquisitionRequest,
  KnowledgeAcquisitionResult,
  RetrievedKnowledgeClaim,
  RetrievedKnowledgeSource,
} from "./acquisition.js";

const NPM_REGISTRY_ORIGIN = "https://registry.npmjs.org";
const MAX_RESPONSE_BYTES = 60_000;

export interface NpmDecisionKnowledgeAcquisitionOptions {
  readonly fetchImpl?: typeof fetch;
  readonly clock?: () => Date;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function readBoundedText(response: Response): Promise<string> {
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`npm registry returned HTTP ${response.status}.`);
  }
  if (!response.body) throw new Error("npm registry returned an empty response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("npm registry response exceeded the bounded Alpha decision evidence size.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

function exactVersionFragment(raw: string, version: string): string {
  const quoted = JSON.stringify(version);
  const index = raw.indexOf(`"version":${quoted}`);
  if (index >= 0) return raw.slice(index, index + `"version":${quoted}`.length);
  const spaced = new RegExp(`"version"\\s*:\\s*${quoted.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "u").exec(raw)?.[0];
  if (!spaced) throw new Error("npm registry response did not contain its exact version field.");
  return spaced;
}

function runtimeDependencyCount(value: Record<string, unknown>): number {
  const dependencies = value.dependencies;
  if (dependencies === undefined) return 0;
  const dependencyRecord = record(dependencies);
  if (!dependencyRecord) throw new Error("npm registry runtime dependency metadata is malformed.");
  return Object.keys(dependencyRecord).length;
}

/**
 * Retrieve only the two package-version documents explicitly named by the USER
 * for the bounded Alpha decision capability. Returned metadata remains merely
 * proposed information; the npm-specific V36 policy independently parses and
 * recomputes the dependency count before it can become decision evidence.
 */
export class NpmDecisionKnowledgeAcquisitionProvider implements KnowledgeAcquisitionProvider {
  readonly kind = "npm-latest-package-metadata-v1";
  private readonly fetchImpl: typeof fetch;
  private readonly clock: () => Date;

  constructor(options: NpmDecisionKnowledgeAcquisitionOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.clock = options.clock ?? (() => new Date());
  }

  async acquire(request: KnowledgeAcquisitionRequest): Promise<KnowledgeAcquisitionResult> {
    const semantics = parseAlphaNpmDecisionSemantics(request.objective);
    if (!semantics) {
      throw new Error("The npm decision acquisition provider requires an explicit supported package-choice objective.");
    }

    const retrievedAt = this.clock().toISOString();
    const sources: RetrievedKnowledgeSource[] = [];
    const claims: RetrievedKnowledgeClaim[] = [];

    for (const packageName of semantics.candidates) {
      const url = new URL(`${NPM_REGISTRY_ORIGIN}/${encodeURIComponent(packageName)}/latest`);
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: "GET",
          redirect: "error",
          headers: {
            accept: "application/json",
            "user-agent": "Lattice-Decision-Evidence/0.1 (npm metadata retrieval; no truth authority)",
          },
        });
      } catch (error) {
        throw new Error(`npm registry was unavailable: ${error instanceof Error ? error.message : "request failed"}.`);
      }

      const raw = await readBoundedText(response);
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error("npm registry returned malformed JSON.");
      }
      const metadata = record(parsed);
      const returnedName = typeof metadata?.name === "string" ? metadata.name.trim().toLocaleLowerCase("en-US") : "";
      const version = typeof metadata?.version === "string" ? metadata.version.trim() : "";
      if (!metadata || returnedName !== packageName || !version) {
        throw new Error(`npm registry returned metadata for an unexpected package or version: ${packageName}.`);
      }

      const count = runtimeDependencyCount(metadata);
      const versionFragment = exactVersionFragment(raw, version);
      const sourceId = `npm:${packageName}@${version}`;
      sources.push({
        sourceId,
        canonicalUri: url.href,
        title: `${packageName}@${version} npm registry metadata`,
        publisher: "npm registry",
        retrievedAt,
        publishedAt: null,
        contentType: "application/json; charset=utf-8",
        content: raw,
        metadata: {
          sourceAdapter: this.kind,
          packageName,
          packageVersion: version,
          evidentiarySuitability: "AUTHORITATIVE_DOMAIN",
        },
      });
      claims.push({
        claimId: `npm-runtime-dependencies:${packageName}@${version}`,
        text: `Package ${packageName}@${version} declares ${count} runtime ${count === 1 ? "dependency" : "dependencies"} in npm registry metadata.`,
        claimType: "QUANTITATIVE",
        scope: `npm package ${packageName}`,
        effectiveAt: retrievedAt,
        unit: "runtime dependencies",
        denominator: `${packageName}@${version}`,
        baseline: "npm registry latest-version metadata",
        period: `latest-tag observation at ${retrievedAt}`,
        qualifiers: [
          { key: "decision-criterion", value: ALPHA_NPM_RUNTIME_DEPENDENCY_CRITERION_ID },
          { key: "npm-package", value: packageName },
          { key: "npm-version", value: version },
          { key: "computed-runtime-dependency-count", value: String(count) },
        ],
        evidence: [{ sourceId, relation: "SUPPORTS", excerpt: versionFragment }],
      });
    }

    return { sources, claims };
  }
}

/**
 * Keep the existing A1 acquisition path intact for every request outside the
 * bounded npm decision slice. This router changes where A3 looks, not what V36
 * may believe.
 */
export class AlphaDecisionKnowledgeAcquisitionProvider implements KnowledgeAcquisitionProvider {
  readonly kind: string;
  private readonly npm: NpmDecisionKnowledgeAcquisitionProvider;

  constructor(
    private readonly fallback: KnowledgeAcquisitionProvider,
    npm: NpmDecisionKnowledgeAcquisitionProvider = new NpmDecisionKnowledgeAcquisitionProvider(),
  ) {
    this.npm = npm;
    this.kind = `alpha-decision:${npm.kind}:fallback:${fallback.kind}`;
  }

  async acquire(request: KnowledgeAcquisitionRequest): Promise<KnowledgeAcquisitionResult> {
    return parseAlphaNpmDecisionSemantics(request.objective)
      ? this.npm.acquire(request)
      : this.fallback.acquire(request);
  }
}
