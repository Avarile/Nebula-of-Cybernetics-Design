import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { ListDeadJobsDto } from './dto/calendar.dto';
import { SchedulingService } from './scheduling.service';

/**
 * Running the poller — admin only.
 *
 * `GET status` returns the numbers worth alerting on. The one that matters is
 * `overdue5m`: anything above zero means the poller is behind or dead, and no
 * other signal says that. `oldestDueAgeSeconds` is the observed lag,
 * `inFlight` persistently non-zero means leases are being held too long, and
 * `dead` is work that has exhausted its retries and needs a human.
 *
 * The `run/*` endpoints exist so a fix can be verified now rather than at the
 * next tick — particularly the nightly materializer, whose feedback loop is
 * otherwise a day long.
 */
@ApiTags('Scheduler')
@Roles('admin')
@Controller('scheduler')
export class SchedulingAdminController {
  constructor(private readonly scheduler: SchedulingService) {}

  @ApiOperation({ summary: 'Scheduler health counters' })
  @Get('status')
  status() {
    return this.scheduler.status();
  }

  @ApiOperation({ summary: 'List dead-lettered jobs' })
  @Get('dead')
  dead(@Query() query: ListDeadJobsDto) {
    return this.scheduler.listDead(query.limit);
  }

  @ApiOperation({ summary: 'Jobs scheduled for one occurrence' })
  @Get('occurrences/:id/jobs')
  jobsForOccurrence(@Param('id', ParseUUIDPipe) id: string) {
    return this.scheduler.jobsForOccurrence(id);
  }

  /**
   * Works for any module's subject — `invoice`, `calendar_event`, whatever the
   * scheduling caller declared. The occurrence route above is the calendar's
   * special case of this one, kept because a support question is usually
   * "why did this meeting not remind me?".
   */
  @ApiOperation({ summary: 'Jobs scheduled for one subject' })
  @Get('subjects/:type/:id/jobs')
  jobsForSubject(
    @Param('type') type: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.scheduler.jobsFor(type, id);
  }

  @ApiOperation({ summary: 'Requeue a dead-lettered job' })
  @Post('dead/:id/requeue')
  requeue(@Param('id', ParseUUIDPipe) id: string) {
    return this.scheduler.requeueDead(id);
  }

  @ApiOperation({ summary: 'Run one poller tick now' })
  @Post('run/tick')
  tick() {
    return this.scheduler.runTick();
  }

  @ApiOperation({ summary: 'Return expired leases to the queue now' })
  @Post('run/reap')
  reap() {
    return this.scheduler.runReap();
  }

  @ApiOperation({ summary: 'Expand the recurrence horizon now' })
  @Post('run/materialize')
  materialize() {
    return this.scheduler.runMaterialize();
  }
}
