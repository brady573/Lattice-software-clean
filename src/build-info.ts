/**
 * Served-revision provenance for the read-only revision surface.
 *
 * The served commit is build-time injected, never computed at request time:
 * the deployment build provides `LATTICE_BUILD_SHA`, falling back to the
 * hosting platform's build commit (`RENDER_GIT_COMMIT`, already used for
 * source provenance elsewhere in this repository). When no provenance was
 * injected, the surface honestly reports `"unknown"` instead of implying a
 * revision it cannot establish.
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
 * Resolve the exact commit SHA baked in at build time. Explicit build
 * injection wins so a build pipeline can attest its own revision even where
 * the platform also exposes one.
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

export function resolveBuildInfo(env: NodeJS.ProcessEnv = process.env): BuildInfo {
  const commit = resolveBuildCommit(env);
  const buildTime = resolveBuildTime(env);
  return buildTime === undefined ? { commit } : { commit, buildTime };
}
