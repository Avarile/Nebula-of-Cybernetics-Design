import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { requireUserId, type Principal } from '../../common/principal';
import { RequirePermission } from '../authorization/require-permission.decorator';
import {
  ListNotificationsDto,
  SetNotificationPreferenceDto,
  SuppressDto,
  UpsertTemplateDto,
} from './dto/notification.dto';
import { NotificationAdminService } from './notification-admin.service';
import { NotificationService } from './notification.service';

/** Own notification history and preferences. Always scoped to the caller. */
@ApiTags('Notifications')
@Controller('notifications')
export class NotificationController {
  constructor(
    private readonly notifications: NotificationService,
    private readonly admin: NotificationAdminService,
  ) {}

  @ApiOperation({ summary: 'Your notification history' })
  @Get()
  @Roles('user', 'admin')
  list(
    @Query() query: ListNotificationsDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.notifications.listForUser(
      requireUserId(principal),
      query.page,
      query.limit,
    );
  }

  @ApiOperation({ summary: 'Your notification preferences' })
  @Get('preferences')
  @Roles('user', 'admin')
  preferences(@CurrentUser() principal: Principal) {
    return this.admin.listPreferences(principal);
  }

  @ApiOperation({ summary: 'Set one notification preference' })
  @Put('preferences')
  @Roles('user', 'admin')
  setPreference(
    @Body() dto: SetNotificationPreferenceDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.admin.setPreference(principal, dto);
  }
}

/** Template, catalog and suppression administration. */
@ApiTags('Notifications')
@Roles('admin')
@Controller('system/notifications')
export class NotificationAdminController {
  constructor(private readonly admin: NotificationAdminService) {}

  @ApiOperation({ summary: 'List notification event types' })
  @Get('event-types')
  @RequirePermission('notification.manage')
  eventTypes() {
    return this.admin.listEventTypes();
  }

  @ApiOperation({ summary: 'List templates' })
  @Get('templates')
  @RequirePermission('notification.manage')
  templates() {
    return this.admin.listTemplates();
  }

  @ApiOperation({ summary: 'Create or update a template' })
  @Put('templates/:key')
  @RequirePermission('notification.manage')
  upsertTemplate(@Param('key') key: string, @Body() dto: UpsertTemplateDto) {
    return this.admin.upsertTemplate(key, dto);
  }

  @ApiOperation({ summary: 'List suppressed addresses' })
  @Get('suppressions')
  @RequirePermission('notification.manage')
  suppressions(@Query() query: ListNotificationsDto) {
    return this.admin.listSuppressions(query.page, query.limit);
  }

  @ApiOperation({ summary: 'Suppress an address' })
  @Post('suppressions')
  @RequirePermission('notification.manage')
  @HttpCode(204)
  async suppress(@Body() dto: SuppressDto): Promise<void> {
    await this.admin.suppress(dto);
  }

  @ApiOperation({ summary: 'Remove a suppression' })
  @Delete('suppressions/:email')
  @RequirePermission('notification.manage')
  @HttpCode(204)
  async unsuppress(@Param('email') email: string): Promise<void> {
    await this.admin.unsuppress(email);
  }
}
