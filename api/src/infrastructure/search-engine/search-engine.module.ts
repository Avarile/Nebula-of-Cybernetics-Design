import { Global, Module } from '@nestjs/common';
import { MEILI_CLIENT, SEARCH_ENGINE } from './meili.constants';
import { meiliClientProvider } from './meili.provider';
import { SearchEngineService } from './search-engine.service';

/**
 * MeiliSearch-backed search engine. Exposes the `SEARCH_ENGINE` abstraction
 * (used by the search-service feature) and the raw `MEILI_CLIENT` (used by the
 * health indicator). Global so any feature can depend on `SEARCH_ENGINE`.
 */
@Global()
@Module({
  providers: [
    meiliClientProvider,
    { provide: SEARCH_ENGINE, useClass: SearchEngineService },
  ],
  exports: [SEARCH_ENGINE, MEILI_CLIENT],
})
export class SearchEngineModule {}
