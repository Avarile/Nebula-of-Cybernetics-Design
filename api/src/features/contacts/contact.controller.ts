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
import { ContactGraphService } from './contact-graph.service';
import { ContactService } from './contact.service';
import {
  AddChannelDto,
  CreateContactDto,
  ListContactsDto,
  UpdateContactDto,
} from './dto/contact.dto';
import {
  CreateInteractionDto,
  CreateRelationshipDto,
  ListInteractionsDto,
} from './dto/graph.dto';

/**
 * Contacts, their channels, relationships and interaction timeline.
 *
 * Row scope is enforced in the service by `resolveContactAccess`, not here: a
 * non-owner sees a private contact as 404, and the list query narrows in SQL so
 * the page and its total agree.
 */
@ApiTags('Contacts')
@Controller('contacts')
export class ContactController {
  constructor(
    private readonly contacts: ContactService,
    private readonly graph: ContactGraphService,
  ) {}

  @ApiOperation({ summary: 'List contacts' })
  @Get()
  @Roles('user', 'admin', 'agent')
  @RequirePermission('contact.read')
  list(@Query() query: ListContactsDto, @CurrentUser() principal: Principal) {
    return this.contacts.list(query, principal);
  }

  @ApiOperation({ summary: 'Create a contact' })
  @Post()
  @Roles('user', 'admin', 'agent')
  @RequirePermission('contact.create')
  create(@Body() dto: CreateContactDto, @CurrentUser() principal: Principal) {
    return this.contacts.create(dto, principal);
  }

  @ApiOperation({ summary: 'Get a contact' })
  @Get(':id')
  @Roles('user', 'admin', 'agent')
  @RequirePermission('contact.read')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
  ) {
    return this.contacts.get(id, principal);
  }

  @ApiOperation({ summary: 'Update a contact' })
  @Patch(':id')
  @Roles('user', 'admin')
  @RequirePermission('contact.update')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContactDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.contacts.update(id, dto, principal);
  }

  @ApiOperation({ summary: 'Delete a contact' })
  @Delete(':id')
  @Roles('user', 'admin')
  @RequirePermission('contact.delete')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
  ): Promise<void> {
    await this.contacts.remove(id, principal);
  }

  // --- channels ---

  @ApiOperation({ summary: "A contact's channels" })
  @Get(':id/channels')
  @Roles('user', 'admin', 'agent')
  @RequirePermission('contact.read')
  channels(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
  ) {
    return this.contacts.listChannels(id, principal);
  }

  @ApiOperation({ summary: 'Add a channel' })
  @Post(':id/channels')
  @Roles('user', 'admin')
  @RequirePermission('contact.update')
  addChannel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddChannelDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.contacts.addChannel(id, dto, principal);
  }

  @ApiOperation({ summary: 'Remove a channel' })
  @Delete(':id/channels/:channelId')
  @Roles('user', 'admin')
  @RequirePermission('contact.update')
  @HttpCode(204)
  async removeChannel(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @CurrentUser() principal: Principal,
  ): Promise<void> {
    await this.contacts.removeChannel(id, channelId, principal);
  }

  // --- relationships ---

  @ApiOperation({ summary: "A contact's relationships" })
  @Get(':id/relationships')
  @Roles('user', 'admin', 'agent')
  @RequirePermission('contact.read')
  relationships(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
  ) {
    return this.graph.relationships(id, principal);
  }

  @ApiOperation({ summary: 'Relate two contacts' })
  @Post(':id/relationships')
  @Roles('user', 'admin')
  @RequirePermission('contact.update')
  addRelationship(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateRelationshipDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.graph.addRelationship(id, dto, principal);
  }

  @ApiOperation({ summary: 'Remove a relationship' })
  @Delete(':id/relationships/:relationshipId')
  @Roles('user', 'admin')
  @RequirePermission('contact.update')
  @HttpCode(204)
  async removeRelationship(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('relationshipId', ParseUUIDPipe) relationshipId: string,
    @CurrentUser() principal: Principal,
  ): Promise<void> {
    await this.graph.removeRelationship(id, relationshipId, principal);
  }

  // --- interactions ---

  @ApiOperation({ summary: "A contact's interaction timeline" })
  @Get(':id/interactions')
  @Roles('user', 'admin', 'agent')
  @RequirePermission('contact.read')
  interactions(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListInteractionsDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.graph.listInteractions(id, query.page, query.limit, principal);
  }

  @ApiOperation({ summary: 'Log an interaction' })
  @Post(':id/interactions')
  @Roles('user', 'admin', 'agent')
  @RequirePermission('contact.update')
  addInteraction(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateInteractionDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.graph.addInteraction(id, dto, principal);
  }

  @ApiOperation({ summary: 'Remove an interaction' })
  @Delete(':id/interactions/:interactionId')
  @Roles('user', 'admin')
  @RequirePermission('contact.update')
  @HttpCode(204)
  async removeInteraction(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('interactionId', ParseUUIDPipe) interactionId: string,
    @CurrentUser() principal: Principal,
  ): Promise<void> {
    await this.graph.removeInteraction(id, interactionId, principal);
  }
}
