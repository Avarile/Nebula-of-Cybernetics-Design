import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { Principal } from '../../common/principal';
import { RequirePermission } from '../authorization/require-permission.decorator';
import { SetPreferenceDto, UpdateProfileDto } from './dto/profile.dto';
import { ProfileService } from './profile.service';

/**
 * Own-profile and own-preferences.
 *
 * Every route here is scoped to the caller by construction — the user id comes
 * from the principal, never from the path — so there is no way to address
 * another user's profile through it. Reading someone else's is a separate,
 * permission-gated route below.
 */
@ApiTags('Users')
@Controller('me')
export class ProfileController {
  constructor(private readonly profiles: ProfileService) {}

  @ApiOperation({ summary: 'Your profile' })
  @Get('profile')
  @Roles('user', 'admin')
  get(@CurrentUser() principal: Principal) {
    return this.profiles.getOwn(principal);
  }

  @ApiOperation({ summary: 'Update your profile' })
  @Patch('profile')
  @Roles('user', 'admin')
  update(@CurrentUser() principal: Principal, @Body() dto: UpdateProfileDto) {
    return this.profiles.updateOwn(principal, dto);
  }

  @ApiOperation({ summary: 'Your preferences' })
  @Get('preferences')
  @Roles('user', 'admin')
  listPreferences(@CurrentUser() principal: Principal) {
    return this.profiles.listPreferences(principal);
  }

  @ApiOperation({ summary: 'Set one preference' })
  @Put('preferences/:key')
  @Roles('user', 'admin')
  setPreference(
    @CurrentUser() principal: Principal,
    @Param('key') key: string,
    @Body() dto: SetPreferenceDto,
  ) {
    return this.profiles.setPreference(principal, key, dto);
  }

  @ApiOperation({ summary: 'Clear one preference' })
  @Delete('preferences/:key')
  @Roles('user', 'admin')
  @HttpCode(204)
  async removePreference(
    @CurrentUser() principal: Principal,
    @Param('key') key: string,
  ): Promise<void> {
    await this.profiles.removePreference(principal, key);
  }
}

/** Reading another user's profile — an administrative capability. */
@ApiTags('Users')
@Roles('admin')
@Controller('users')
export class UserProfileAdminController {
  constructor(private readonly profiles: ProfileService) {}

  @ApiOperation({ summary: "Get a user's profile" })
  @Get(':id/profile')
  @RequirePermission('user.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.profiles.get(id);
  }
}
