import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  PersistOptionsDto,
  PersistRecordsDto,
} from './dto/persist-records.dto';
import { SearchRecordService } from './search-record.service';

/**
 * Record persistence. Admin-only: persist (upsert on externalId) and delete.
 * Writes land in Postgres and are indexed asynchronously (202 Accepted). Pass
 * `?wait=true` to block, briefly and boundedly, until the records have settled.
 */
@ApiTags('Search')
@Controller('search/collections/:name/records')
@Roles('admin')
export class RecordController {
  constructor(private readonly records: SearchRecordService) {}

  @ApiOperation({ summary: 'Persist records into a collection' })
  @Post()
  @HttpCode(202)
  persist(
    @Param('name') name: string,
    @Body() dto: PersistRecordsDto,
    @Query() options: PersistOptionsDto,
  ) {
    return this.records.persist(name, dto.records, options.wait);
  }

  @ApiOperation({ summary: 'Delete a record by id' })
  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('name') name: string,
    @Param('id') id: string,
  ): Promise<void> {
    await this.records.remove(name, id);
  }
}
