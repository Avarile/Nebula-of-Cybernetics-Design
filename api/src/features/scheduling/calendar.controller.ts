import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { Principal } from '../../common/principal';
import { RequirePermission } from '../authorization/require-permission.decorator';
import { CalendarService } from './calendar.service';
import {
  CreateEventDto,
  ListEventsDto,
  ListRangeDto,
  MoveOccurrenceDto,
  UpdateEventDto,
} from './dto/calendar.dto';

/**
 * Calendar events and the instances they expand into.
 *
 * The API speaks WALL CLOCK, not instants: `startLocal` plus `timezone` on the
 * way in, and a local range on the way out. That is not a convenience — an
 * instant sent for a recurring event cannot express "09:00 every day", because
 * the instant that means 09:00 changes twice a year.
 *
 * An event belonging to another user answers 404, not 403: 403 would confirm
 * the id exists, which is not something a personal calendar should disclose.
 */
@ApiTags('Calendar')
@Controller('calendar/events')
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @ApiOperation({ summary: 'List your calendar events (rules)' })
  @Get()
  @Roles('user', 'admin')
  @RequirePermission('calendar.read')
  list(@Query() query: ListEventsDto, @CurrentUser() principal: Principal) {
    return this.calendar.list(query, principal);
  }

  /**
   * The calendar read. `from`/`to` are LOCAL dates (`to` exclusive) and are
   * converted using `timezone`, defaulting to the caller's profile zone.
   */
  @ApiOperation({ summary: 'List occurrences in a local date range' })
  @Get('occurrences')
  @Roles('user', 'admin')
  @RequirePermission('calendar.read')
  listRange(@Query() query: ListRangeDto, @CurrentUser() principal: Principal) {
    return this.calendar.listRange(query, principal);
  }

  @ApiOperation({ summary: 'Create a calendar event' })
  @Post()
  @Roles('user', 'admin')
  @RequirePermission('calendar.write')
  create(@Body() dto: CreateEventDto, @CurrentUser() principal: Principal) {
    return this.calendar.create(dto, principal);
  }

  @ApiOperation({ summary: 'Get a calendar event' })
  @Get(':id')
  @Roles('user', 'admin')
  @RequirePermission('calendar.read')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
  ) {
    return this.calendar.get(id, principal);
  }

  /** Bumps the version, which invalidates every future job in one statement. */
  @ApiOperation({ summary: 'Update a calendar event' })
  @Patch(':id')
  @Roles('user', 'admin')
  @RequirePermission('calendar.write')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEventDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.calendar.update(id, dto, principal);
  }

  @ApiOperation({ summary: 'Cancel a calendar event (keeps the history)' })
  @Post(':id/cancel')
  @Roles('user', 'admin')
  @RequirePermission('calendar.write')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
  ) {
    return this.calendar.cancel(id, principal);
  }

  @ApiOperation({ summary: 'Delete a calendar event' })
  @Delete(':id')
  @HttpCode(204)
  @Roles('user', 'admin')
  @RequirePermission('calendar.write')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
  ): Promise<void> {
    await this.calendar.remove(id, principal);
  }
}

/**
 * Single-instance overrides.
 *
 * Separate controller because the resource is different: an occurrence has its
 * own id and its own lifecycle, and moving one instance must not read like
 * editing the series.
 */
@ApiTags('Calendar')
@Controller('calendar/occurrences')
export class CalendarOccurrenceController {
  constructor(private readonly calendar: CalendarService) {}

  @ApiOperation({ summary: 'Move or retitle one instance of a series' })
  @Patch(':id')
  @Roles('user', 'admin')
  @RequirePermission('calendar.write')
  move(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveOccurrenceDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.calendar.moveOccurrence(id, dto, principal);
  }

  @ApiOperation({ summary: 'Cancel one instance of a series' })
  @Post(':id/cancel')
  @Roles('user', 'admin')
  @RequirePermission('calendar.write')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
  ) {
    return this.calendar.cancelOccurrence(id, principal);
  }
}
