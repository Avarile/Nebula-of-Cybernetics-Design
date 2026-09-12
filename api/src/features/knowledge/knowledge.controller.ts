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
import {
  CreateGrantDto,
  CreateKnowledgeDto,
  LinkContactDto,
  ListKnowledgeDto,
  TransitionKnowledgeDto,
  UpdateKnowledgeDto,
} from './dto/knowledge.dto';
import { KnowledgeAclService } from './knowledge-acl.service';
import { KnowledgeService } from './knowledge.service';

/**
 * Knowledge records, their lifecycle and their access grants.
 *
 * Row access is decided by `resolveKnowledgeAccess` in the service: an
 * unreadable record answers 404, and an action the caller may see but not
 * perform answers 403 naming the level it needs.
 */
@ApiTags('Knowledge')
@Controller('knowledge')
export class KnowledgeController {
  constructor(
    private readonly knowledge: KnowledgeService,
    private readonly acl: KnowledgeAclService,
  ) {}

  @ApiOperation({ summary: 'List knowledge you can read' })
  @Get()
  @Roles('user', 'admin', 'agent')
  @RequirePermission('knowledge.read')
  list(@Query() query: ListKnowledgeDto, @CurrentUser() principal: Principal) {
    return this.knowledge.list(query, principal);
  }

  @ApiOperation({ summary: 'Create a knowledge record' })
  @Post()
  @Roles('user', 'admin', 'agent')
  @RequirePermission('knowledge.create')
  create(@Body() dto: CreateKnowledgeDto, @CurrentUser() principal: Principal) {
    return this.knowledge.create(dto, principal);
  }

  @ApiOperation({ summary: 'Get a knowledge record' })
  @Get(':id')
  @Roles('user', 'admin', 'agent')
  @RequirePermission('knowledge.read')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
  ) {
    return this.knowledge.get(id, principal);
  }

  @ApiOperation({ summary: 'Update a knowledge record' })
  @Patch(':id')
  @Roles('user', 'admin')
  @RequirePermission('knowledge.update')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateKnowledgeDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.knowledge.update(id, dto, principal);
  }

  @ApiOperation({ summary: 'Move a record through its lifecycle' })
  @Post(':id/status')
  @Roles('user', 'admin')
  @RequirePermission('knowledge.publish')
  transition(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransitionKnowledgeDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.knowledge.transition(id, dto, principal);
  }

  @ApiOperation({ summary: 'Delete a knowledge record' })
  @Delete(':id')
  @Roles('user', 'admin')
  @RequirePermission('knowledge.delete')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
  ): Promise<void> {
    await this.knowledge.remove(id, principal);
  }

  // --- access control ---

  @ApiOperation({ summary: 'List grants on a record' })
  @Get(':id/grants')
  @Roles('user', 'admin')
  @RequirePermission('knowledge.manage_access')
  listGrants(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
  ) {
    return this.acl.listGrants(id, principal);
  }

  @ApiOperation({ summary: 'Grant access to a record' })
  @Post(':id/grants')
  @Roles('user', 'admin')
  @RequirePermission('knowledge.manage_access')
  grant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateGrantDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.acl.grant(id, dto, principal);
  }

  @ApiOperation({ summary: 'Revoke a grant' })
  @Delete(':id/grants/:grantId')
  @Roles('user', 'admin')
  @RequirePermission('knowledge.manage_access')
  @HttpCode(204)
  async revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('grantId', ParseUUIDPipe) grantId: string,
    @CurrentUser() principal: Principal,
  ): Promise<void> {
    await this.acl.revoke(id, grantId, principal);
  }

  // --- contact links ---

  @ApiOperation({ summary: 'Contacts referenced by a record' })
  @Get(':id/contacts')
  @Roles('user', 'admin', 'agent')
  @RequirePermission('knowledge.read')
  contacts(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
  ) {
    return this.acl.listContacts(id, principal);
  }

  @ApiOperation({ summary: 'Reference a contact from a record' })
  @Post(':id/contacts')
  @Roles('user', 'admin')
  @RequirePermission('knowledge.update')
  linkContact(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkContactDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.acl.linkContact(id, dto, principal);
  }

  @ApiOperation({ summary: 'Remove a contact reference' })
  @Delete(':id/contacts/:linkId')
  @Roles('user', 'admin')
  @RequirePermission('knowledge.update')
  @HttpCode(204)
  async unlinkContact(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('linkId', ParseUUIDPipe) linkId: string,
    @CurrentUser() principal: Principal,
  ): Promise<void> {
    await this.acl.unlinkContact(id, linkId, principal);
  }
}
