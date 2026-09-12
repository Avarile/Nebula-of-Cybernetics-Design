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
import { userIdOrNull, type Principal } from '../../common/principal';
import { CreateTagDto, ListTagsDto, UpdateTagDto } from './dto/tag.dto';
import { TagService } from './tag.service';

/**
 * The shared tag vocabulary.
 *
 * Reads are open to any authenticated principal — tags are labels, and the
 * agent needs them to describe what it files. Writes are admin-only: a
 * vocabulary anyone can extend stops being one, and duplicate near-synonyms are
 * what make faceted search useless.
 */
@ApiTags('Tags')
@Controller('tags')
export class TagController {
  constructor(private readonly tags: TagService) {}

  @ApiOperation({ summary: 'List tags' })
  @Get()
  @Roles('user', 'admin', 'agent')
  list(@Query() query: ListTagsDto) {
    return this.tags.list(query);
  }

  @ApiOperation({ summary: 'Get a tag' })
  @Get(':id')
  @Roles('user', 'admin', 'agent')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.tags.get(id);
  }

  @ApiOperation({ summary: 'Create a tag' })
  @Post()
  @Roles('admin')
  create(@Body() dto: CreateTagDto, @CurrentUser() principal: Principal) {
    return this.tags.create(dto, userIdOrNull(principal));
  }

  @ApiOperation({ summary: 'Update a tag' })
  @Patch(':id')
  @Roles('admin')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTagDto) {
    return this.tags.update(id, dto);
  }

  @ApiOperation({ summary: 'Delete a tag' })
  @Delete(':id')
  @Roles('admin')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.tags.remove(id);
  }
}
