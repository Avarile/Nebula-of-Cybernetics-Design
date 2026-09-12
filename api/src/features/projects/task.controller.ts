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
  AddDependencyDto,
  CreateTaskDto,
  ListTasksDto,
  ListTimeDto,
  LogTimeDto,
  MoveTaskDto,
  UpdateTaskDto,
  UpdateTimeDto,
} from './dto/task.dto';
import { ProjectLinkService } from './project-link.service';
import { TaskService } from './task.service';

/**
 * Tasks, their dependencies, watchers and logged time.
 *
 * A task carries no ACL of its own: every route resolves the caller's role on
 * the task's project. Listing without a project filter is narrowed to the
 * projects the caller can see, so a cross-project board cannot leak.
 */
@ApiTags('Tasks')
@Controller('tasks')
export class TaskController {
  constructor(
    private readonly tasks: TaskService,
    private readonly links: ProjectLinkService,
  ) {}

  @ApiOperation({ summary: 'List tasks' })
  @Get()
  @Roles('user', 'admin', 'agent')
  @RequirePermission('project.task.read')
  list(@Query() query: ListTasksDto, @CurrentUser() principal: Principal) {
    return this.tasks.list(query, principal);
  }

  @ApiOperation({ summary: 'Create a task' })
  @Post()
  @Roles('user', 'admin', 'agent')
  @RequirePermission('project.task.create')
  create(@Body() dto: CreateTaskDto, @CurrentUser() principal: Principal) {
    return this.tasks.create(dto, principal);
  }

  @ApiOperation({ summary: 'Logged time' })
  @Get('time')
  @Roles('user', 'admin')
  @RequirePermission('project.time.log')
  listTime(@Query() query: ListTimeDto, @CurrentUser() principal: Principal) {
    return this.links.listTime(query, principal);
  }

  @ApiOperation({ summary: 'Correct a time entry' })
  @Patch('time/:entryId')
  @Roles('user', 'admin')
  @RequirePermission('project.time.log')
  updateTime(
    @Param('entryId', ParseUUIDPipe) entryId: string,
    @Body() dto: UpdateTimeDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.links.updateTime(entryId, dto, principal);
  }

  @ApiOperation({ summary: 'Delete a time entry' })
  @Delete('time/:entryId')
  @Roles('user', 'admin')
  @RequirePermission('project.time.log')
  @HttpCode(204)
  async removeTime(
    @Param('entryId', ParseUUIDPipe) entryId: string,
    @CurrentUser() principal: Principal,
  ): Promise<void> {
    await this.links.removeTime(entryId, principal);
  }

  @ApiOperation({ summary: 'Get a task' })
  @Get(':id')
  @Roles('user', 'admin', 'agent')
  @RequirePermission('project.task.read')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
  ) {
    return this.tasks.get(id, principal);
  }

  @ApiOperation({ summary: 'Update a task' })
  @Patch(':id')
  @Roles('user', 'admin', 'agent')
  @RequirePermission('project.task.update')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.tasks.update(id, dto, principal);
  }

  @ApiOperation({ summary: 'Move a task on the board' })
  @Post(':id/move')
  @Roles('user', 'admin')
  @RequirePermission('project.task.update')
  move(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveTaskDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.tasks.move(id, dto, principal);
  }

  @ApiOperation({ summary: 'Delete a task' })
  @Delete(':id')
  @Roles('user', 'admin')
  @RequirePermission('project.task.delete')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
  ): Promise<void> {
    await this.tasks.remove(id, principal);
  }

  // --- dependencies ---

  @ApiOperation({ summary: "A task's dependencies" })
  @Get(':id/dependencies')
  @Roles('user', 'admin', 'agent')
  @RequirePermission('project.task.read')
  dependencies(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
  ) {
    return this.tasks.dependencies(id, principal);
  }

  @ApiOperation({ summary: 'Add a predecessor' })
  @Post(':id/dependencies')
  @Roles('user', 'admin')
  @RequirePermission('project.task.update')
  addDependency(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddDependencyDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.tasks.addDependency(id, dto, principal);
  }

  @ApiOperation({ summary: 'Remove a dependency' })
  @Delete(':id/dependencies/:dependencyId')
  @Roles('user', 'admin')
  @RequirePermission('project.task.update')
  @HttpCode(204)
  async removeDependency(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('dependencyId', ParseUUIDPipe) dependencyId: string,
    @CurrentUser() principal: Principal,
  ): Promise<void> {
    await this.tasks.removeDependency(id, dependencyId, principal);
  }

  // --- watchers ---

  @ApiOperation({ summary: "A task's watchers" })
  @Get(':id/watchers')
  @Roles('user', 'admin')
  @RequirePermission('project.task.read')
  watchers(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
  ) {
    return this.tasks.watchers(id, principal);
  }

  @ApiOperation({ summary: 'Watch a task' })
  @Post(':id/watch')
  @Roles('user', 'admin')
  @RequirePermission('project.task.read')
  @HttpCode(204)
  async watch(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
  ): Promise<void> {
    await this.tasks.watch(id, principal);
  }

  @ApiOperation({ summary: 'Stop watching a task' })
  @Delete(':id/watch')
  @Roles('user', 'admin')
  @RequirePermission('project.task.read')
  @HttpCode(204)
  async unwatch(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
  ): Promise<void> {
    await this.tasks.unwatch(id, principal);
  }

  // --- time ---

  @ApiOperation({ summary: 'Log time against a task' })
  @Post(':id/time')
  @Roles('user', 'admin')
  @RequirePermission('project.time.log')
  logTime(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LogTimeDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.links.logTime(id, dto, principal);
  }
}
