import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Ip,
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
import { CreateImapDto } from './dto/create-imap.dto';
import { ListQueryDto } from './dto/list-query.dto';
import { UpdateImapDto } from './dto/update-imap.dto';
import { ImapConfigService } from './imap-config.service';
import type { AuditContext } from './system-audit.types';

@Roles('admin')
@ApiTags('System')
@Controller('system/imap')
export class ImapConfigController {
  constructor(private readonly imap: ImapConfigService) {}

  private ctx(user: Principal, ip: string, ua?: string): AuditContext {
    return { actorId: userIdOrNull(user), ip, userAgent: ua ?? null };
  }

  @ApiOperation({ summary: 'Create IMAP config' })
  @Post()
  create(
    @Body() dto: CreateImapDto,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.imap.create(dto, this.ctx(user, ip, ua));
  }

  @ApiOperation({ summary: 'List IMAP configs' })
  @Get()
  list(@Query() query: ListQueryDto) {
    return this.imap.list(query.page, query.limit);
  }

  @ApiOperation({ summary: 'Get IMAP config by id' })
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.imap.findById(id);
  }

  @ApiOperation({ summary: 'Update IMAP config' })
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateImapDto,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.imap.update(id, dto, this.ctx(user, ip, ua));
  }

  @ApiOperation({ summary: 'Delete IMAP config' })
  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ): Promise<void> {
    await this.imap.remove(id, this.ctx(user, ip, ua));
  }

  @ApiOperation({ summary: 'Activate IMAP config' })
  @Post(':id/activate')
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.imap.activate(id, this.ctx(user, ip, ua));
  }

  @ApiOperation({ summary: 'Test IMAP config' })
  @Post(':id/test')
  test(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.imap.test(id, this.ctx(user, ip, ua));
  }
}
