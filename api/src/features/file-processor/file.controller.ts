import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { InitiateUploadDto } from './dto/initiate-upload.dto';
import { QueryFilesDto } from './dto/query-files.dto';
import { FileService } from './file.service';
import type { FilePrincipal } from './file.types';

/**
 * External file API (users). Presigned-only: uploads are initiate → (client
 * uploads directly to MinIO) → complete; downloads are short-lived presigned
 * GET URLs. Ownership is enforced in FileService via the resolved principal.
 *
 * Restricted to human accounts. A file's owner is a `users.id`, and a service
 * credential has none — an `agent`-role caller's uploads would land in the
 * ownerless bucket shared with internal pipelines, and it could not read them
 * back. Machine file access needs an owner model of its own first.
 */
@ApiTags('Files')
@Roles('user', 'admin')
@Controller('files')
export class FileController {
  constructor(private readonly files: FileService) {}

  @ApiOperation({ summary: 'Initiate presigned upload' })
  @Post()
  initiate(
    @Body() body: InitiateUploadDto,
    @CurrentUser() user: FilePrincipal,
  ) {
    return this.files.initiateUpload(body, user);
  }

  @ApiOperation({ summary: 'Complete presigned upload' })
  @Post(':id/complete')
  complete(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CompleteUploadDto,
    @CurrentUser() user: FilePrincipal,
  ) {
    return this.files.completeUpload(id, user, body);
  }

  @ApiOperation({ summary: 'Get presigned download URL' })
  @Get(':id/download-url')
  downloadUrl(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('ttl') ttl: string | undefined,
    @CurrentUser() user: FilePrincipal,
  ) {
    const parsed = ttl ? Number(ttl) : undefined;
    const valid = parsed && Number.isFinite(parsed) && parsed > 0;
    return this.files.getDownloadUrl(id, user, {
      ttl: valid ? parsed : undefined,
    });
  }

  @ApiOperation({ summary: 'Get file metadata' })
  @Get(':id')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: FilePrincipal,
  ) {
    return this.files.getMetadata(id, user);
  }

  @ApiOperation({ summary: 'List files' })
  @Get()
  list(@Query() query: QueryFilesDto, @CurrentUser() user: FilePrincipal) {
    return this.files.list(query, user);
  }

  @ApiOperation({ summary: 'Soft-delete file' })
  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: FilePrincipal,
  ): Promise<void> {
    await this.files.softDelete(id, user);
  }
}
