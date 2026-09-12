import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { ListSystemEventsDto } from './dto/system-ops.dto';
import { SystemEventService } from './system-event.service';

/** Structured operational events — admin-only, like the audit log. */
@ApiTags('System')
@Roles('admin')
@Controller('system/events')
export class SystemEventController {
  constructor(private readonly events: SystemEventService) {}

  @ApiOperation({ summary: 'List system events' })
  @Get()
  list(@Query() query: ListSystemEventsDto) {
    return this.events.list(query);
  }
}
