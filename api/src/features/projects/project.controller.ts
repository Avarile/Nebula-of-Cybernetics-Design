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
  AddMemberDto,
  CreateProjectDto,
  LinkKnowledgeDto,
  LinkProjectContactDto,
  ListProjectsDto,
  UpdateProjectDto,
} from './dto/project.dto';
import {
  CreateGoalDto,
  CreateMilestoneDto,
  UpdateGoalDto,
  UpdateMilestoneDto,
} from './dto/planning.dto';
import { PlanningService } from './planning.service';
import { ProjectLinkService } from './project-link.service';
import { ProjectService } from './project.service';

/**
 * Projects, their membership, planning artefacts and references.
 *
 * Every route resolves the caller's project role in the service; a non-member
 * sees a private project as 404 and an under-privileged member gets a 403
 * naming the role the action needs.
 */
@ApiTags('Projects')
@Controller('projects')
export class ProjectController {
  constructor(
    private readonly projects: ProjectService,
    private readonly planning: PlanningService,
    private readonly links: ProjectLinkService,
  ) {}

  @ApiOperation({ summary: 'List projects you can see' })
  @Get()
  @Roles('user', 'admin', 'agent')
  @RequirePermission('project.read')
  list(@Query() query: ListProjectsDto, @CurrentUser() principal: Principal) {
    return this.projects.list(query, principal);
  }

  @ApiOperation({ summary: 'Create a project' })
  @Post()
  @Roles('user', 'admin', 'agent')
  @RequirePermission('project.create')
  create(@Body() dto: CreateProjectDto, @CurrentUser() principal: Principal) {
    return this.projects.create(dto, principal);
  }

  @ApiOperation({ summary: 'Get a project' })
  @Get(':id')
  @Roles('user', 'admin', 'agent')
  @RequirePermission('project.read')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
  ) {
    return this.projects.get(id, principal);
  }

  @ApiOperation({ summary: 'Update a project' })
  @Patch(':id')
  @Roles('user', 'admin')
  @RequirePermission('project.update')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.projects.update(id, dto, principal);
  }

  @ApiOperation({ summary: 'Delete a project' })
  @Delete(':id')
  @Roles('user', 'admin')
  @RequirePermission('project.delete')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
  ): Promise<void> {
    await this.projects.remove(id, principal);
  }

  // --- members ---

  @ApiOperation({ summary: 'List project members' })
  @Get(':id/members')
  @Roles('user', 'admin', 'agent')
  @RequirePermission('project.read')
  members(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
  ) {
    return this.projects.listMembers(id, principal);
  }

  @ApiOperation({ summary: 'Add or re-role a member' })
  @Post(':id/members')
  @Roles('user', 'admin')
  @RequirePermission('project.manage_members')
  @HttpCode(204)
  async addMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddMemberDto,
    @CurrentUser() principal: Principal,
  ): Promise<void> {
    await this.projects.addMember(id, dto, principal);
  }

  @ApiOperation({ summary: 'Remove a member' })
  @Delete(':id/members/:userId')
  @Roles('user', 'admin')
  @RequirePermission('project.manage_members')
  @HttpCode(204)
  async removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() principal: Principal,
  ): Promise<void> {
    await this.projects.removeMember(id, userId, principal);
  }

  // --- milestones ---

  @ApiOperation({ summary: 'List milestones' })
  @Get(':id/milestones')
  @Roles('user', 'admin', 'agent')
  @RequirePermission('project.read')
  milestones(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
  ) {
    return this.planning.listMilestones(id, principal);
  }

  @ApiOperation({ summary: 'Create a milestone' })
  @Post(':id/milestones')
  @Roles('user', 'admin')
  @RequirePermission('project.update')
  createMilestone(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateMilestoneDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.planning.createMilestone(id, dto, principal);
  }

  @ApiOperation({ summary: 'Update a milestone' })
  @Patch('milestones/:milestoneId')
  @Roles('user', 'admin')
  @RequirePermission('project.update')
  updateMilestone(
    @Param('milestoneId', ParseUUIDPipe) milestoneId: string,
    @Body() dto: UpdateMilestoneDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.planning.updateMilestone(milestoneId, dto, principal);
  }

  @ApiOperation({ summary: 'Delete a milestone' })
  @Delete('milestones/:milestoneId')
  @Roles('user', 'admin')
  @RequirePermission('project.update')
  @HttpCode(204)
  async removeMilestone(
    @Param('milestoneId', ParseUUIDPipe) milestoneId: string,
    @CurrentUser() principal: Principal,
  ): Promise<void> {
    await this.planning.removeMilestone(milestoneId, principal);
  }

  // --- goals ---

  @ApiOperation({ summary: "A project's goals, plus organizational ones" })
  @Get(':id/goals')
  @Roles('user', 'admin', 'agent')
  @RequirePermission('project.read')
  goals(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
  ) {
    return this.planning.listGoals(id, principal);
  }

  @ApiOperation({ summary: 'Create a goal on a project' })
  @Post(':id/goals')
  @Roles('user', 'admin')
  @RequirePermission('project.update')
  createGoal(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateGoalDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.planning.createGoal(dto, id, principal);
  }

  @ApiOperation({ summary: 'Update a goal' })
  @Patch('goals/:goalId')
  @Roles('user', 'admin')
  @RequirePermission('project.update')
  updateGoal(
    @Param('goalId', ParseUUIDPipe) goalId: string,
    @Body() dto: UpdateGoalDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.planning.updateGoal(goalId, dto, principal);
  }

  @ApiOperation({ summary: 'Delete a goal' })
  @Delete('goals/:goalId')
  @Roles('user', 'admin')
  @RequirePermission('project.update')
  @HttpCode(204)
  async removeGoal(
    @Param('goalId', ParseUUIDPipe) goalId: string,
    @CurrentUser() principal: Principal,
  ): Promise<void> {
    await this.planning.removeGoal(goalId, principal);
  }

  // --- references ---

  @ApiOperation({ summary: 'Knowledge referenced by a project' })
  @Get(':id/knowledge')
  @Roles('user', 'admin', 'agent')
  @RequirePermission('project.read')
  knowledge(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
  ) {
    return this.links.knowledgeLinks(id, principal);
  }

  @ApiOperation({ summary: 'Reference a knowledge record' })
  @Post(':id/knowledge')
  @Roles('user', 'admin')
  @RequirePermission('project.update')
  linkKnowledge(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkKnowledgeDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.links.linkKnowledge(id, dto, principal);
  }

  @ApiOperation({ summary: 'Remove a knowledge reference' })
  @Delete(':id/knowledge/:linkId')
  @Roles('user', 'admin')
  @RequirePermission('project.update')
  @HttpCode(204)
  async unlinkKnowledge(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('linkId', ParseUUIDPipe) linkId: string,
    @CurrentUser() principal: Principal,
  ): Promise<void> {
    await this.links.unlinkKnowledge(id, linkId, principal);
  }

  @ApiOperation({ summary: 'Contacts involved in a project' })
  @Get(':id/contacts')
  @Roles('user', 'admin', 'agent')
  @RequirePermission('project.read')
  contacts(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
  ) {
    return this.links.contactLinks(id, principal);
  }

  @ApiOperation({ summary: 'Involve a contact' })
  @Post(':id/contacts')
  @Roles('user', 'admin')
  @RequirePermission('project.update')
  linkContact(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkProjectContactDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.links.linkContact(id, dto, principal);
  }

  @ApiOperation({ summary: 'Remove a contact link' })
  @Delete(':id/contacts/:linkId')
  @Roles('user', 'admin')
  @RequirePermission('project.update')
  @HttpCode(204)
  async unlinkContact(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('linkId', ParseUUIDPipe) linkId: string,
    @CurrentUser() principal: Principal,
  ): Promise<void> {
    await this.links.unlinkContact(id, linkId, principal);
  }

  @ApiOperation({ summary: 'Billable time not yet invoiced' })
  @Get(':id/unbilled-time')
  @Roles('user', 'admin')
  @RequirePermission('project.time.approve')
  unbilled(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
  ) {
    return this.links.unbilledFor(id, principal);
  }
}
