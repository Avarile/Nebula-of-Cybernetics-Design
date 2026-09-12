import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { isAdmin, requireUserId, type Principal } from '../../common/principal';
import { ActivityService } from './activity.service';
import { ListActivityDto } from './dto/activity.dto';

/**
 * Activity feeds.
 *
 * Two routes rather than one filtered route, because they answer questions with
 * different access rules and conflating them is how a feed leaks. `/activity/me`
 * is always the caller's own actions. `/activity` is an unfiltered cross-entity
 * read and is therefore admin-only — a per-entity feed for ordinary users
 * arrives with the entity modules, which can scope it against their own
 * membership rules.
 */
@ApiTags('Activity')
@Controller('activity')
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @ApiOperation({ summary: 'Your own activity' })
  @Get('me')
  @Roles('user', 'admin')
  mine(@Query() query: ListActivityDto, @CurrentUser() principal: Principal) {
    return this.activity.list({
      ...query,
      // Ignore any actor filter the caller supplied: this route is defined as
      // "mine", and honouring the parameter would make it "anyone's".
      actorUserId: requireUserId(principal),
    });
  }

  @ApiOperation({ summary: 'Activity across the system (admin)' })
  @Get()
  @Roles('admin')
  list(@Query() query: ListActivityDto, @CurrentUser() principal: Principal) {
    // Defence in depth: RolesGuard already restricts this route, but the check
    // costs nothing and keeps the rule visible at the call site.
    if (!isAdmin(principal)) return { data: [], total: 0, page: 1, limit: 0 };
    return this.activity.list(query);
  }
}
