import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MeiliSearch } from 'meilisearch';
import type { SearchConfig } from '../../config/configurations/search.config';
import { MEILI_CLIENT } from './meili.constants';

/**
 * Builds the MeiliSearch client from validated config. Like the MinIO client,
 * it is a stateless HTTP client — no shutdown lifecycle needed.
 */
export const meiliClientProvider: Provider = {
  provide: MEILI_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): MeiliSearch => {
    const cfg = config.getOrThrow<SearchConfig>('search');
    return new MeiliSearch({
      host: cfg.host,
      apiKey: cfg.apiKey,
      timeout: cfg.searchTimeoutMs,
    });
  },
};
