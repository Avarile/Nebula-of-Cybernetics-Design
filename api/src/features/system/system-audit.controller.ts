import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditQueryDto } from './dto/list-query.dto';
import { SystemAuditService } from './system-audit.service';

/** Read-only audit trail for system-records changes. Admin only. */
@Roles('admin')
@ApiTags('System')
@Controller('system/audit')
export class SystemAuditController {
  constructor(private readonly audit: SystemAuditService) {}

  @ApiOperation({ summary: 'List system audit log entries' })
  @Get()
  list(@Query() query: AuditQueryDto) {
    return this.audit.list(query);
  }
}
