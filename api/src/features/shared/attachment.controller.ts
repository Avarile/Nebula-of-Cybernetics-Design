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
import type { Principal } from '../../common/principal';
import { AttachmentService } from './attachment.service';
import { AttachFileDto, ListAttachmentsDto } from './dto/attachment.dto';

/**
 * Binds already-uploaded files to entities. Upload itself stays on the file
 * endpoints; this only records the association.
 */
@ApiTags('Attachments')
@Controller('attachments')
export class AttachmentController {
  constructor(private readonly attachments: AttachmentService) {}

  @ApiOperation({ summary: 'List attachments on an entity' })
  @Get()
  @Roles('user', 'admin', 'agent')
  list(
    @Query() query: ListAttachmentsDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.attachments.list(
      query.entityType,
      query.entityId,
      query.page,
      query.limit,
      principal,
    );
  }

  @ApiOperation({ summary: 'Attach a file to an entity' })
  @Post()
  @Roles('user', 'admin', 'agent')
  attach(@Body() dto: AttachFileDto, @CurrentUser() principal: Principal) {
    return this.attachments.attach(dto, principal);
  }

  @ApiOperation({ summary: 'Detach a file' })
  @Delete(':id')
  @Roles('user', 'admin')
  @HttpCode(204)
  async detach(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
  ): Promise<void> {
    await this.attachments.detach(id, principal);
  }
}
