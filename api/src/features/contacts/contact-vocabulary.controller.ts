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
import { ContactVocabularyService } from './contact-vocabulary.service';
import {
  CreateCategoryDto,
  CreateContactTypeDto,
  UpdateCategoryDto,
  UpdateContactTypeDto,
} from './dto/vocabulary.dto';

/**
 * Contact types and the category tree.
 *
 * Reads are open to any authenticated caller — a client cannot render a contact
 * without them. Writes are admin-only: a vocabulary anyone can extend stops
 * being one.
 */
@ApiTags('Contacts')
@Controller('contact-vocabulary')
export class ContactVocabularyController {
  constructor(private readonly vocabulary: ContactVocabularyService) {}

  @ApiOperation({ summary: 'List contact types' })
  @Get('types')
  @Roles('user', 'admin', 'agent')
  listTypes() {
    return this.vocabulary.listTypes();
  }

  @ApiOperation({ summary: 'Create a contact type' })
  @Post('types')
  @Roles('admin')
  createType(@Body() dto: CreateContactTypeDto) {
    return this.vocabulary.createType(dto);
  }

  @ApiOperation({ summary: 'Update a contact type' })
  @Patch('types/:id')
  @Roles('admin')
  updateType(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContactTypeDto,
  ) {
    return this.vocabulary.updateType(id, dto);
  }

  @ApiOperation({ summary: 'Delete a contact type' })
  @Delete('types/:id')
  @Roles('admin')
  @HttpCode(204)
  async removeType(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.vocabulary.removeType(id);
  }

  @ApiOperation({ summary: 'List contact categories' })
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
