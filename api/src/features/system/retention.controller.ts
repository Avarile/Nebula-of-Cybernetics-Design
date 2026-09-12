import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  RETENTION_ENTITY_TYPES,
  UpdateRetentionDto,
} from './dto/system-ops.dto';
import { RetentionService } from './retention.service';

type RetentionEntity = (typeof RETENTION_ENTITY_TYPES)[number];

/**
 * Retention policy administration — admin-only.
 *
 * `email_messages` and `search_records` ship disabled because purging them
 * destroys content rather than trimming a log. Enabling either is possible here
 * and is logged at WARN, but should be paired with an export.
 */
@ApiTags('System')
@Roles('admin')
@Controller('system/retention')
export class RetentionController {
  constructor(private readonly retention: RetentionService) {}

  @ApiOperation({ summary: 'List retention policies' })
  @Get()
  list() {
    return this.retention.list();
  }

  /**
   * `entityType` is validated here rather than left to the database. Untouched,
   * an unknown value reached a Postgres enum column and came back as SQLSTATE
   * 22P02 — a 500 — so `RETENTION_POLICY_NOT_FOUND` below was unreachable.
   */
  @ApiOperation({ summary: 'Update a retention policy' })
  @Patch(':entityType')
  async update(
    @Param('entityType', new ParseEnumPipe(RETENTION_ENTITY_TYPES))
    entityType: RetentionEntity,
    @Body() dto: UpdateRetentionDto,
  ) {
    if (dto.retentionDays !== undefined) {
      await this.retention.setRetentionDays(entityType, dto.retentionDays);
    }
    if (dto.enabled !== undefined) {
      await this.retention.setEnabled(entityType, dto.enabled);
    }
    const policies = await this.retention.list();
    return policies.find((p) => p.entityType === entityType);
  }

  @ApiOperation({ summary: 'Run the retention sweep now' })
  @Post('run')
  run() {
    return this.retention.runAll();
  }
}
