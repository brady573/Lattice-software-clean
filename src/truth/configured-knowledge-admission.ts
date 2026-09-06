import { IRS_HOME_SALE_TOPIC_URL } from "../knowledge/irs-acquisition.js";
import type {
  KnowledgeEvidenceAdmissionPolicy,
  KnowledgeEvidenceDisposition,
  KnowledgeEvidenceQualificationInput,
} from "./knowledge-acquisition-pipeline.js";
import { ExactSourceReportAdmissionPolicy } from "./knowledge-acquisition-pipeline.js";

export const AUTHORITATIVE_DOMAIN_PROVENANCE_PREFIX = "a1-suitability:authoritative-domain:irs:";
export const GENERAL_REFERENCE_PROVENANCE_PREFIX = "a1-suitability:general-reference:wikipedia:";

function canonicalHost(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.hostname : null;
  } catch {
    return null;
  }
}

function exactPinnedIrsTopic(value: string): boolean {
  try {
    const expected = new URL(IRS_HOME_SALE_TOPIC_URL);
    const actual = new URL(value);
    return actual.protocol === "https:"
      && actual.origin === expected.origin
      && actual.pathname === expected.pathname;
  } catch {
    return false;
  }
}

/**
 * Canonical-runtime source-suitability authority for A1. It wraps the existing
 * exact source-report admission policy and changes no V36 verdict semantics.
 * Suitability is encoded only in Product-owned provenance metadata produced by
 * this policy; acquisition metadata is never trusted for the classification.
 */
export class ConfiguredKnowledgeEvidenceAdmissionPolicy implements KnowledgeEvidenceAdmissionPolicy {
  private readonly base = new ExactSourceReportAdmissionPolicy();

  disposition(input: KnowledgeEvidenceQualificationInput): KnowledgeEvidenceDisposition {
    const disposition = this.base.disposition(input);
    if (!disposition.admitted || disposition.verification !== "VERIFIED") return disposition;
    const baseKey = disposition.provenanceComponentKey ?? "source";

    if (exactPinnedIrsTopic(input.source.canonicalUri)) {
      return {
        ...disposition,
        provenanceComponentKey: `${AUTHORITATIVE_DOMAIN_PROVENANCE_PREFIX}${baseKey}`,
      };
    }

    const host = canonicalHost(input.source.canonicalUri);
    if (host === "wikipedia.org" || host?.endsWith(".wikipedia.org")) {
      return {
        ...disposition,
        provenanceComponentKey: `${GENERAL_REFERENCE_PROVENANCE_PREFIX}${baseKey}`,
      };
    }

    return disposition;
  }
}
