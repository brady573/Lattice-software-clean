import { createHash } from "node:crypto";
import { ALPHA_NPM_RUNTIME_DEPENDENCY_CRITERION_ID } from "../decision/alpha-decision-capability.js";
import { requiredProofObligations } from "./contracts.js";
import {
  ExactSourceReportAdmissionPolicy,
  type KnowledgeEvidenceAdmissionPolicy,
  type KnowledgeEvidenceDisposition,
  type KnowledgeEvidenceQualificationInput,
} from "./knowledge-acquisition-pipeline.js";

const NPM_REGISTRY_ORIGIN = "https://registry.npmjs.org";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function qualifier(input: KnowledgeEvidenceQualificationInput, key: string): string | undefined {
  return input.claim.qualifiers.find((item) => item.key === key)?.value;
}

function sourcePackage(canonical: URL): string | null {
  const [encodedPackageName, tag, ...extra] = canonical.pathname.split("/").filter(Boolean);
  if (encodedPackageName === undefined || tag !== "latest" || extra.length > 0) return null;
  try {
    const packageName = decodeURIComponent(encodedPackageName).toLocaleLowerCase("en-US");
    return /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/u.test(packageName)
      ? packageName
      : null;
  } catch {
    return null;
  }
}

function runtimeDependencyCount(metadata: Record<string, unknown>): number | null {
  if (metadata.dependencies === undefined) return 0;
  const dependencies = record(metadata.dependencies);
  return dependencies ? Object.keys(dependencies).length : null;
}

function rejected(reason: string): KnowledgeEvidenceDisposition {
  return {
    verification: "UNVERIFIED",
    admitted: false,
    rejectionReason: reason,
    provenanceComponentKey: null,
    provenanceConfidence: "UNKNOWN",
    authoritativePrimary: false,
    establishedProofKinds: [],
  };
}

/**
 * V36 policy for one narrow quantitative source contract. It does not trust the
 * acquisition adapter's proposed count. Instead it independently parses the raw
 * npm version document, recomputes Object.keys(dependencies).length, validates
 * the package/version/unit/scope qualifiers, and only then marks every required
 * QUANTITATIVE proof obligation satisfied.
 */
export class NpmRuntimeDependencyAdmissionPolicy implements KnowledgeEvidenceAdmissionPolicy {
  supports(input: KnowledgeEvidenceQualificationInput): boolean {
    let canonical: URL;
    try {
      canonical = new URL(input.source.canonicalUri);
    } catch {
      return false;
    }
    return canonical.origin === NPM_REGISTRY_ORIGIN
      && qualifier(input, "decision-criterion") === ALPHA_NPM_RUNTIME_DEPENDENCY_CRITERION_ID;
  }

  disposition(input: KnowledgeEvidenceQualificationInput): KnowledgeEvidenceDisposition {
    if (!this.supports(input)) return rejected("Evidence is outside the bounded npm dependency-count V36 contract.");

    let canonical: URL;
    try {
      canonical = new URL(input.source.canonicalUri);
    } catch {
      return rejected("npm decision evidence has an invalid source URI.");
    }
    const packageFromUri = sourcePackage(canonical);
    if (!packageFromUri) return rejected("npm decision evidence is not bound to an exact package/latest source.");

    const expectedHash = digest(`${input.source.canonicalUri}\u0000${input.sourceContent}`);
    if (input.source.artifactHash !== expectedHash) {
      return rejected("npm decision evidence failed source-content integrity verification.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(input.sourceContent);
    } catch {
      return rejected("npm decision source content is not valid JSON.");
    }
    const metadata = record(parsed);
    const packageName = typeof metadata?.name === "string" ? metadata.name.trim().toLocaleLowerCase("en-US") : "";
    const version = typeof metadata?.version === "string" ? metadata.version.trim() : "";
    const count = metadata ? runtimeDependencyCount(metadata) : null;
    if (!metadata || packageName !== packageFromUri || !version || count === null) {
      return rejected("npm decision source does not expose a valid package/version dependency document.");
    }

    const expectedClaimText = `Package ${packageName}@${version} declares ${count} runtime ${count === 1 ? "dependency" : "dependencies"} in npm registry metadata.`;
    const expectedDenominator = `${packageName}@${version}`;
    const expectedPeriod = `latest-tag observation at ${input.source.retrievedAt}`;
    const exactSemantics = input.claim.claimType === "QUANTITATIVE"
      && input.claim.text === expectedClaimText
      && input.claim.scope === `npm package ${packageName}`
      && input.claim.effectiveAt === input.source.retrievedAt
      && input.claim.unit === "runtime dependencies"
      && input.claim.denominator === expectedDenominator
      && input.claim.baseline === "npm registry latest-version metadata"
      && input.claim.period === expectedPeriod
      && qualifier(input, "npm-package") === packageName
      && qualifier(input, "npm-version") === version
      && qualifier(input, "computed-runtime-dependency-count") === String(count)
      && input.proposed.relation === "SUPPORTS"
      && input.proposed.excerpt.length > 0
      && input.sourceContent.includes(input.proposed.excerpt)
      && input.proposed.excerpt.includes(version);
    if (!exactSemantics) {
      return rejected("npm decision evidence does not match the independently recomputed quantitative semantics.");
    }

    return {
      verification: "VERIFIED",
      admitted: true,
      rejectionReason: null,
      provenanceComponentKey: `source-origin:${digest(`${NPM_REGISTRY_ORIGIN}\u0000${packageName}@${version}`).slice(0, 24)}`,
      provenanceConfidence: "HIGH",
      // npm is authoritative for the exact package-version metadata it serves;
      // this does not make npm authoritative over USER intent or the decision.
      authoritativePrimary: true,
      // SOURCE_VALUE + INDEPENDENT_RECOMPUTATION come from independently
      // counting the raw dependencies object. The remaining obligations are
      // checked against the exact source URI, version scope and typed fields.
      establishedProofKinds: [...requiredProofObligations("QUANTITATIVE")],
    };
  }
}

/** Preserve the ordinary A1 exact-source policy outside the supported A3 source contract. */
export class AlphaDecisionKnowledgeEvidenceAdmissionPolicy implements KnowledgeEvidenceAdmissionPolicy {
  private readonly npm = new NpmRuntimeDependencyAdmissionPolicy();
  private readonly fallback = new ExactSourceReportAdmissionPolicy();

  disposition(input: KnowledgeEvidenceQualificationInput): KnowledgeEvidenceDisposition {
    return this.npm.supports(input)
      ? this.npm.disposition(input)
      : this.fallback.disposition(input);
  }
}
