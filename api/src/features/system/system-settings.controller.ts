import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Ip,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { userIdOrNull, type Principal } from '../../common/principal';
import { SettingsQueryDto, UpsertSettingDto } from './dto/upsert-setting.dto';
import { SystemSettingsService } from './system-settings.service';
import type { AuditContext } from './system-audit.types';

@Roles('admin')
@ApiTags('System')
@Controller('system/settings')
export class SystemSettingsController {
  constructor(private readonly settings: SystemSettingsService) {}

  private ctx(user: Principal, ip: string, ua?: string): AuditContext {
    return { actorId: userIdOrNull(user), ip, userAgent: ua ?? null };
  }

  @ApiOperation({ summary: 'List system settings' })
  @Get()
  list(@Query() query: SettingsQueryDto) {
    return this.settings.list(query);
  }

  @ApiOperation({ summary: 'Get system setting by key' })
  @Get(':key')
  get(@Param('key') key: string) {
    return this.settings.get(key);
  }

  @ApiOperation({ summary: 'Create or update system setting' })
  @Put(':key')
  upsert(
    @Param('key') key: string,
    @Body() dto: UpsertSettingDto,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.settings.upsert(key, dto, this.ctx(user, ip, ua));
  }

  @ApiOperation({ summary: 'Delete system setting' })
  @Delete(':key')
  @HttpCode(204)
  async remove(
    @Param('key') key: string,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ): Promise<void> {
    await this.settings.remove(key, this.ctx(user, ip, ua));
  }
}
