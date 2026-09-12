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
import { CommentService } from './comment.service';
import {
  CreateCommentDto,
  ListCommentsDto,
  UpdateCommentDto,
} from './dto/comment.dto';

/**
 * Comments on any commentable entity.
 *
 * Every route is scoped by the parent entity, not by this controller: the
 * service asks `EntityAccessRegistry` whether the caller may read the parent,
 * and an entity type no module has registered is denied to non-admins.
 */
@ApiTags('Comments')
@Controller('comments')
export class CommentController {
  constructor(private readonly comments: CommentService) {}

  @ApiOperation({ summary: 'List comments on an entity' })
  @Get()
  @Roles('user', 'admin', 'agent')
  list(@Query() query: ListCommentsDto, @CurrentUser() principal: Principal) {
    return this.comments.list(query, principal);
  }

  @ApiOperation({ summary: 'Add a comment' })
  @Post()
  @Roles('user', 'admin', 'agent')
  create(@Body() dto: CreateCommentDto, @CurrentUser() principal: Principal) {
    return this.comments.create(dto, principal);
  }

  @ApiOperation({ summary: 'Edit your own comment' })
  @Patch(':id')
  @Roles('user', 'admin')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCommentDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.comments.update(id, dto, principal);
  }

  @ApiOperation({ summary: 'Delete a comment' })
  @Delete(':id')
  @Roles('user', 'admin')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
  ): Promise<void> {
    await this.comments.remove(id, principal);
  }
}
