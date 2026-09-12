import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { Principal } from '../../common/principal';
import { SearchQueryDto } from './dto/search-query.dto';
import { SearchRecordService } from './search-record.service';

/**
 * Query + reload surface.
 *
 * `query` and `getRecord` accept any authenticated principal, but WHAT they
 * return is decided by the collection's `visibility` policy inside
 * `SearchRecordService` — the role guard cannot answer an ownership question,
 * so it does not try to. `reload` is admin-only and runs the full
 * clear-and-rebuild through BullMQ.
 */
@ApiTags('Search')
@Controller('search/collections/:name')
export class SearchQueryController {
  constructor(private readonly records: SearchRecordService) {}

  @ApiOperation({ summary: 'Query records in a collection' })
  @Post('query')
  @Roles('user', 'admin', 'agent')
  @HttpCode(200)
  query(
    @Param('name') name: string,
    @Body() body: SearchQueryDto,
    @CurrentUser() user: Principal,
  ) {
    return this.records.search(name, body, user);
  }

  @ApiOperation({ summary: 'Get a single record by id or externalId' })
  @Get('records/:id')
  @Roles('user', 'admin', 'agent')
  getRecord(
    @Param('name') name: string,
    @Param('id') id: string,
    @CurrentUser() user: Principal,
  ) {
    return this.records.get(name, id, user);
  }

  @ApiOperation({ summary: 'Reload and rebuild a collection' })
  @Post('reload')
  @Roles('admin')
  @HttpCode(202)
  async reload(@Param('name') name: string): Promise<{ status: string }> {
    await this.records.reload(name);
    return { status: 'accepted' };
  }
}
