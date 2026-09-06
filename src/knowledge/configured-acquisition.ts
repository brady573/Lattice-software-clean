import type {
  KnowledgeAcquisitionProvider,
  KnowledgeAcquisitionRequest,
  KnowledgeAcquisitionResult,
} from "./acquisition.js";
import { IrsHomeSaleKnowledgeAcquisitionProvider } from "./irs-acquisition.js";
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

/**
 * Minimal A1 source router. It selects one pinned zero-credential IRS path for
 * home-sale tax questions and preserves Wikimedia for the ordinary general
 * route. Neither child adapter confers source suitability or V36 authority.
 */
export class ConfiguredKnowledgeAcquisitionProvider implements KnowledgeAcquisitionProvider {
  readonly kind = "a1-configured-knowledge-acquisition-v1";
  private readonly irsProvider: IrsHomeSaleKnowledgeAcquisitionProvider;
  private readonly wikimediaProvider: WikimediaKnowledgeAcquisitionProvider;

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
    return await (usesPinnedIrsHomeSaleRoute(request.objective)
      ? this.irsProvider
      : this.wikimediaProvider).acquire(request);
  }
}
