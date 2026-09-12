import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { Principal } from '../../common/principal';
import { GrantPermissionDto, GrantRoleDto } from './dto/rbac.dto';
import { RbacService } from './rbac.service';
import { RequirePermission } from './require-permission.decorator';

/**
 * Role and permission administration.
 *
 * Admin-only by role AND gated on `rbac.manage`. Both, deliberately: the role
 * gate is the existing coarse guarantee, and the permission makes this the
 * worked example of the new layer on the route where it matters most.
 */
@ApiTags('Authorization')
@Roles('admin')
@Controller('authorization')
export class RbacController {
  constructor(private readonly rbac: RbacService) {}

  @ApiOperation({ summary: 'List the permission catalog' })
  @Get('permissions')
  @RequirePermission('rbac.manage')
  listPermissions() {
    return this.rbac.listPermissions();
  }

  @ApiOperation({ summary: 'List roles with their grants' })
  @Get('roles')
  @RequirePermission('rbac.manage')
  listRoles() {
    return this.rbac.listRoles();
  }

  @ApiOperation({ summary: "List a user's roles" })
  @Get('users/:userId/roles')
  @RequirePermission('rbac.manage')
  rolesForUser(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.rbac.rolesForUser(userId);
  }

  @ApiOperation({ summary: "A user's effective permissions" })
  @Get('users/:userId/effective')
  @RequirePermission('rbac.manage')
  effective(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.rbac.effectiveFor(userId);
  }

  @ApiOperation({ summary: 'Grant a role to a user' })
  @Post('users/:userId/roles')
  @HttpCode(204)
  @RequirePermission('rbac.manage')
  async grant(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: GrantRoleDto,
    @CurrentUser() principal: Principal,
  ): Promise<void> {
    await this.rbac.grantRole(userId, dto, principal);
  }

  @ApiOperation({ summary: 'Revoke a role from a user' })
  @Delete('users/:userId/roles/:roleKey')
  @HttpCode(204)
  @RequirePermission('rbac.manage')
  async revoke(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('roleKey') roleKey: string,
    @CurrentUser() principal: Principal,
  ): Promise<void> {
    await this.rbac.revokeRole(userId, roleKey, principal);
  }

  /**
   * Per-user exceptions to the role grants.
   *
   * The resolver has always honoured these and `GET :userId/effective` has
   * always reported their result; until now nothing could create one, so the
   * deny half of the permission model was unreachable.
   */
  @ApiOperation({ summary: "List a user's permission overrides" })
  @Get('users/:userId/permissions')
  @RequirePermission('rbac.manage')
  overrides(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.rbac.overridesForUser(userId);
  }

  @ApiOperation({ summary: 'Grant or deny a permission for one user' })
  @Post('users/:userId/permissions')
  @HttpCode(204)
  @RequirePermission('rbac.manage')
  async grantPermission(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: GrantPermissionDto,
    @CurrentUser() principal: Principal,
  ): Promise<void> {
    await this.rbac.grantPermission(userId, dto, principal);
  }

  @ApiOperation({ summary: "Remove a user's permission override" })
  @Delete('users/:userId/permissions/:permissionKey')
  @HttpCode(204)
  @RequirePermission('rbac.manage')
  async revokePermission(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('permissionKey') permissionKey: string,
    @CurrentUser() principal: Principal,
  ): Promise<void> {
    await this.rbac.revokePermission(userId, permissionKey, principal);
  }
}
