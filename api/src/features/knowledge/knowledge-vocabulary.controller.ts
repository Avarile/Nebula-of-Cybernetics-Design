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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  CreateCategoryDto,
  CreateKnowledgeTypeDto,
  UpdateCategoryDto,
  UpdateKnowledgeTypeDto,
} from './dto/vocabulary.dto';
import { KnowledgeVocabularyService } from './knowledge-vocabulary.service';

/** Knowledge types and categories. Readable by all, writable by admins. */
@ApiTags('Knowledge')
@Controller('knowledge-vocabulary')
export class KnowledgeVocabularyController {
  constructor(private readonly vocabulary: KnowledgeVocabularyService) {}

  // Knowledge Types
  @ApiOperation({ summary: 'List knowledge types' })
  @Get('types')
  @Roles('user', 'admin', 'agent')
  listTypes() {
    return this.vocabulary.listTypes();
  }

  @ApiOperation({ summary: 'Create a knowledge type' })
  @Post('types')
  @Roles('admin')
  createType(@Body() dto: CreateKnowledgeTypeDto) {
    return this.vocabulary.createType(dto);
  }

  @ApiOperation({ summary: 'Update a knowledge type' })
  @Patch('types/:id')
  @Roles('admin')
  updateType(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateKnowledgeTypeDto,
  ) {
    return this.vocabulary.updateType(id, dto);
  }

  @ApiOperation({ summary: 'Delete a knowledge type' })
  @Delete('types/:id')
  @Roles('admin')
  @HttpCode(204)
  async removeType(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.vocabulary.removeType(id);
  }

  // Knowledge Categories
  @ApiOperation({ summary: 'List knowledge categories' })
  @Get('categories')
  @Roles('user', 'admin', 'agent')
  listCategories() {
    return this.vocabulary.listCategories();
  }

  @ApiOperation({ summary: 'Create a category' })
  @Post('categories')
  @Roles('admin')
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.vocabulary.createCategory(dto);
  }

  @ApiOperation({ summary: 'Update or move a category' })
  @Patch('categories/:id')
  @Roles('admin')
  updateCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.vocabulary.updateCategory(id, dto);
  }

  @ApiOperation({ summary: 'Delete a leaf category' })
  @Delete('categories/:id')
  @Roles('admin')
  @HttpCode(204)
  async removeCategory(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.vocabulary.removeCategory(id);
  }
}
