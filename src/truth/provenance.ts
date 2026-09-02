import type {
  ClaimEvidence,
  ProvenanceComponent,
  ProvenanceConfidence,
  SourceArtifact,
  SourceEdge,
} from "./types.js";

const dependentEdgeTypes = new Set(["DERIVES_FROM", "SYNDICATES", "COPIES", "MIRRORS"] as const);
const provenanceRank: Record<ProvenanceConfidence, number> = {
  UNKNOWN: 0,
  LOW: 1,
  MODERATE: 2,
  HIGH: 3,
};

class UnionFind {
  private readonly parent = new Map<string, string>();

  add(value: string): void {
    if (!this.parent.has(value)) this.parent.set(value, value);
  }

  find(value: string): string {
    this.add(value);
    const parent = this.parent.get(value) ?? value;
    if (parent === value) return value;
    const root = this.find(parent);
    this.parent.set(value, root);
    return root;
  }

  union(left: string, right: string): void {
    const a = this.find(left);
    const b = this.find(right);
    if (a === b) return;
    const [root, child] = [a, b].sort();
    if (root && child) this.parent.set(child, root);
  }
}

export function conservativeProvenanceConfidence(
  values: readonly ProvenanceConfidence[],
): ProvenanceConfidence {
  if (values.length === 0) return "UNKNOWN";
  return values.reduce<ProvenanceConfidence>(
    (current, value) => provenanceRank[value] < provenanceRank[current] ? value : current,
    "HIGH",
  );
}

export function deriveProvenanceComponentMap(
  artifacts: SourceArtifact[],
  edges: SourceEdge[],
): Map<string, string | null> {
  const uf = new UnionFind();
  for (const artifact of artifacts) uf.add(artifact.id);

  for (let i = 0; i < artifacts.length; i += 1) {
    const left = artifacts[i];
    if (!left?.provenanceComponentKey) continue;
    for (let j = i + 1; j < artifacts.length; j += 1) {
      const right = artifacts[j];
      if (right?.provenanceComponentKey === left.provenanceComponentKey) {
        uf.union(left.id, right.id);
      }
    }
  }

  for (const edge of edges) {
    if (dependentEdgeTypes.has(edge.edgeType as "DERIVES_FROM" | "SYNDICATES" | "COPIES" | "MIRRORS")) {
      uf.union(edge.fromArtifactId, edge.toArtifactId);
    }
  }

  const keysByRoot = new Map<string, string[]>();
  for (const artifact of artifacts) {
    const root = uf.find(artifact.id);
    if (!artifact.provenanceComponentKey) continue;
    const values = keysByRoot.get(root) ?? [];
    values.push(artifact.provenanceComponentKey);
    keysByRoot.set(root, values);
  }

  const result = new Map<string, string | null>();
  for (const artifact of artifacts) {
    const root = uf.find(artifact.id);
    const keys = [...new Set(keysByRoot.get(root) ?? [])].sort();
    result.set(artifact.id, keys[0] ?? null);
  }
  return result;
}

export function independentSupportComponents(evidence: ClaimEvidence[]): Set<string> {
  return new Set(
    evidence
      .filter(
        (item) =>
          item.admitted
          && item.verification === "VERIFIED"
          && item.relation === "SUPPORTS"
          && item.provenanceConfidence !== "UNKNOWN",
      )
      .map((item) => item.provenanceComponentKey)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  );
}

export function dedupeArtifactsByHash(artifacts: SourceArtifact[]): SourceArtifact[] {
  const seen = new Set<string>();
  const result: SourceArtifact[] = [];
  for (const artifact of artifacts) {
    if (seen.has(artifact.artifactHash)) continue;
    seen.add(artifact.artifactHash);
    result.push(artifact);
  }
  return result;
}

export function recoverOriginalArtifact(
  artifactId: string,
  artifacts: SourceArtifact[],
  edges: SourceEdge[],
): SourceArtifact | undefined {
  const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  let current = artifactId;
  const visited = new Set<string>();

  while (!visited.has(current)) {
    visited.add(current);
    const upstream = edges
      .filter(
        (edge) =>
          edge.fromArtifactId === current
          && dependentEdgeTypes.has(edge.edgeType as "DERIVES_FROM" | "SYNDICATES" | "COPIES" | "MIRRORS"),
      )
      .sort((left, right) => left.toArtifactId.localeCompare(right.toArtifactId))[0];
    if (!upstream) return byId.get(current);
    current = upstream.toArtifactId;
  }

  return byId.get(current);
}

export type ProvenanceSourceAuthority = "PRESERVE_TRUTH_LAYER_SOURCE" | "DERIVE_FROM_EVIDENCE";

export interface NormalizeProvenanceOptions {
  sourceAuthority: ProvenanceSourceAuthority;
  /** Origin identity is retained only for sources already normalized inside V36. */
  trustedOriginSourceIds?: ReadonlySet<string>;
}

export interface NormalizedProvenanceState {
  sources: SourceArtifact[];
  evidence: ClaimEvidence[];
  components: ProvenanceComponent[];
}

/**
 * Canonical V36 provenance normalization operation used by initial compilation
 * and research enrichment. Dependency edges define independence; acquisition
 * metadata cannot create an independent provenance chain by itself.
 */
export function normalizeProvenanceState(
  runId: string,
  sources: readonly SourceArtifact[],
  edges: readonly SourceEdge[],
  evidence: readonly ClaimEvidence[],
  options: NormalizeProvenanceOptions,
): NormalizedProvenanceState {
  const normalizedSources = structuredClone(sources) as SourceArtifact[];
  const normalizedInputEvidence = structuredClone(evidence) as ClaimEvidence[];

  if (options.sourceAuthority === "DERIVE_FROM_EVIDENCE") {
    const evidenceByArtifact = new Map<string, ClaimEvidence[]>();
    for (const item of normalizedInputEvidence) {
      const links = evidenceByArtifact.get(item.artifactId) ?? [];
      links.push(item);
      evidenceByArtifact.set(item.artifactId, links);
    }

    for (const source of normalizedSources) {
      const links = evidenceByArtifact.get(source.id) ?? [];
      const componentKeys = [...new Set(
        links
          .map((item) => item.provenanceComponentKey)
          .filter((value): value is string => typeof value === "string" && value.length > 0),
      )];
      if (componentKeys.length > 1) {
        throw new Error(`Source artifact ${source.id} received conflicting truth-layer provenance components.`);
      }
      source.provenanceComponentKey = componentKeys[0] ?? null;
      source.provenanceConfidence = conservativeProvenanceConfidence(
        links.map((item) => item.provenanceConfidence),
      );
      source.authoritativePrimary = links.some((item) => item.authoritativePrimary);
      if (!options.trustedOriginSourceIds?.has(source.id)) {
        source.originKey = source.provenanceComponentKey;
      }
    }
  }

  const componentByArtifact = deriveProvenanceComponentMap(normalizedSources, [...edges]);
  for (const source of normalizedSources) {
    source.provenanceComponentKey = componentByArtifact.get(source.id) ?? null;
  }

  const componentKeys = [...new Set(
    normalizedSources
      .map((source) => source.provenanceComponentKey)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  )].sort();

  const components: ProvenanceComponent[] = componentKeys.map((key) => {
    const members = normalizedSources.filter((source) => source.provenanceComponentKey === key);
    const recoveredOrigins = members
      .map((source) => recoverOriginalArtifact(source.id, normalizedSources, [...edges]))
      .filter((source): source is SourceArtifact => Boolean(source));
    const canonicalOriginKey = [...new Set(
      recoveredOrigins
        .map((source) => source.originKey)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    )].sort()[0] ?? key;
    return {
      runId,
      key,
      canonicalOriginKey,
      confidence: conservativeProvenanceConfidence(members.map((source) => source.provenanceConfidence)),
    };
  });

  const componentConfidence = new Map(components.map((component) => [component.key, component.confidence]));
  const sourceById = new Map(normalizedSources.map((source) => [source.id, source]));
  const normalizedEvidence = normalizedInputEvidence.map((item) => {
    const source = sourceById.get(item.artifactId);
    if (!source) throw new Error(`Claim evidence ${item.id} references an unknown normalized source.`);
    const componentKey = source.provenanceComponentKey;
    const original = recoverOriginalArtifact(source.id, normalizedSources, [...edges]);
    return {
      ...item,
      provenanceComponentKey: componentKey,
      provenanceConfidence: componentKey
        ? componentConfidence.get(componentKey) ?? "UNKNOWN"
        : "UNKNOWN",
      authoritativePrimary: item.authoritativePrimary && original?.id === source.id,
    };
  });

  return { sources: normalizedSources, evidence: normalizedEvidence, components };
}
