/**
 * Served-revision provenance for the read-only revision surface.
 *
 * The served commit is resolved once from the deployment environment when the
 * app is constructed, then served as an immutable snapshot: the deployment
 * provides `LATTICE_BUILD_SHA`, falling back to the hosting platform's build
 * commit (`RENDER_GIT_COMMIT`, already used for source provenance elsewhere
 * in this repository). When no provenance was provided, the surface honestly
 * reports `"unknown"` instead of implying a revision it cannot establish.
 * Because the snapshot is taken at construction, the served value is never
 * recomputed at request time and is immune to mid-process env mutation.
 */
export const UNKNOWN_BUILD_COMMIT = "unknown";

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed !== undefined && trimmed.length > 0) return trimmed;
  }
  return undefined;
}

/**
 * Resolve the exact commit SHA from the given environment (current
 * `process.env` by default). Explicit build injection wins so a build
 * pipeline can attest its own revision even where the platform also exposes
 * one. The `/api/version` surface calls this once at app construction and
 * serves the resulting snapshot for every request.
 */
export function resolveBuildCommit(env: NodeJS.ProcessEnv = process.env): string {
  return firstNonEmpty(env.LATTICE_BUILD_SHA, env.RENDER_GIT_COMMIT) ?? UNKNOWN_BUILD_COMMIT;
}

/** Optional build timestamp injected alongside the commit SHA. */
export function resolveBuildTime(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return firstNonEmpty(env.LATTICE_BUILD_TIME);
}

export type BuildInfo = {
  commit: string;
  buildTime?: string;
};

/** Resolve build info from the given environment; snapshotted once at app construction by the revision surface. */
export function resolveBuildInfo(env: NodeJS.ProcessEnv = process.env): BuildInfo {
  const commit = resolveBuildCommit(env);
  const buildTime = resolveBuildTime(env);
  return buildTime === undefined ? { commit } : { commit, buildTime };
}
