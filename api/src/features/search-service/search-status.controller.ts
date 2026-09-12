import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { SearchStatusService } from './search-status.service';

/**
 * Admin visibility into the Postgres → Meili indexing pipeline: how many records
 * have converged, how far behind the sweep is, and which records keep failing.
 * Without this, a backlog of FAILED records is invisible until someone notices
 * that search results are missing.
 */
@ApiTags('Search')
@Controller('search')
@Roles('admin')
export class SearchStatusController {
  constructor(private readonly status: SearchStatusService) {}

  @ApiOperation({ summary: 'Index sync status across every collection' })
  @Get('sync-status')
  all() {
    return this.status.status();
  }

  @ApiOperation({
    summary: 'Index sync status for one collection, with failing records',
  })
  @Get('collections/:name/sync-status')
  forCollection(@Param('name') name: string) {
    return this.status.status(name);
  }
}
