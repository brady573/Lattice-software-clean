import type {
  KnowledgeAcquisitionProvider,
  KnowledgeAcquisitionRequest,
  KnowledgeAcquisitionResult,
  RetrievedKnowledgeSource,
} from "./acquisition.js";
import {
  IRS_HOME_SALE_TOPIC_URL,
  IrsHomeSaleKnowledgeAcquisitionProvider,
} from "./irs-acquisition.js";
import type {
  EvidentiarySuitability,
  KnowledgeSourceSuitabilityAuthority,
} from "./source-suitability.js";
import { WikimediaKnowledgeAcquisitionProvider } from "./wikimedia-acquisition.js";

const TAX_PATTERN = /\b(?:tax|taxes|taxation|taxable)\b/iu;
const HOME_PATTERN = /\b(?:home|house|residence|residential)\b/iu;
const SALE_PATTERN = /\b(?:sale|sell|selling|sold)\b/iu;

export interface ConfiguredKnowledgeAcquisitionOptions {
  readonly irsFetchImpl?: typeof fetch;
  readonly wikimediaFetchImpl?: typeof fetch;
  readonly clock?: () => Date;
}

function usesPinnedIrsHomeSaleRoute(objective: string): boolean {
  return TAX_PATTERN.test(objective)
    && HOME_PATTERN.test(objective)
    && SALE_PATTERN.test(objective);
}

function officialIrsSource(source: RetrievedKnowledgeSource): boolean {
  try {
    const expected = new URL(IRS_HOME_SALE_TOPIC_URL);
    const actual = new URL(source.canonicalUri);
    return actual.protocol === "https:"
      && actual.origin === expected.origin
      && actual.pathname === expected.pathname;
  } catch {
    return false;
  }
}

function wikipediaSource(source: RetrievedKnowledgeSource): boolean {
  try {
    const canonical = new URL(source.canonicalUri);
    return canonical.protocol === "https:"
      && (canonical.hostname === "wikipedia.org" || canonical.hostname.endsWith(".wikipedia.org"));
  } catch {
    return false;
  }
}

/**
 * Minimal A1 source router plus Product-owned suitability authority. Suitability
 * is bound to source object identity from the exact configured child route, so
 * an arbitrary acquisition result cannot self-promote by copying metadata,
 * publisher text, or even an official-looking URL.
 */
export class ConfiguredKnowledgeAcquisitionProvider
implements KnowledgeAcquisitionProvider, KnowledgeSourceSuitabilityAuthority {
  readonly kind = "a1-configured-knowledge-acquisition-v1";
  private readonly irsProvider: IrsHomeSaleKnowledgeAcquisitionProvider;
  private readonly wikimediaProvider: WikimediaKnowledgeAcquisitionProvider;
  private readonly suitabilityBySource = new WeakMap<RetrievedKnowledgeSource, EvidentiarySuitability>();

  constructor(options: ConfiguredKnowledgeAcquisitionOptions = {}) {
    this.irsProvider = new IrsHomeSaleKnowledgeAcquisitionProvider({
      ...(options.irsFetchImpl ? { fetchImpl: options.irsFetchImpl } : {}),
      ...(options.clock ? { clock: options.clock } : {}),
    });
    this.wikimediaProvider = new WikimediaKnowledgeAcquisitionProvider({
      ...(options.wikimediaFetchImpl ? { fetchImpl: options.wikimediaFetchImpl } : {}),
      ...(options.clock ? { clock: options.clock } : {}),
    });
  }

  async acquire(request: KnowledgeAcquisitionRequest): Promise<KnowledgeAcquisitionResult> {
    const officialRoute = usesPinnedIrsHomeSaleRoute(request.objective);
    const result = await (officialRoute ? this.irsProvider : this.wikimediaProvider).acquire(request);
    for (const source of result.sources) {
      const suitability = officialRoute && officialIrsSource(source)
        ? "AUTHORITATIVE_DOMAIN"
        : !officialRoute && wikipediaSource(source)
          ? "GENERAL_REFERENCE"
          : "UNKNOWN";
      this.suitabilityBySource.set(source, suitability);
    }
    return result;
  }

  suitabilityFor(source: RetrievedKnowledgeSource): EvidentiarySuitability {
    return this.suitabilityBySource.get(source) ?? "UNKNOWN";
  }
}
