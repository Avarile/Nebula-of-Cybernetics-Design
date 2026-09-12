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
import { CreateSmtpDto } from './dto/create-smtp.dto';
import { ListQueryDto } from './dto/list-query.dto';
import { UpdateSmtpDto } from './dto/update-smtp.dto';
import { SmtpConfigService } from './smtp-config.service';
import type { AuditContext } from './system-audit.types';

@Roles('admin')
@ApiTags('System')
@Controller('system/smtp')
export class SmtpConfigController {
  constructor(private readonly smtp: SmtpConfigService) {}

  private ctx(user: Principal, ip: string, ua?: string): AuditContext {
    return { actorId: userIdOrNull(user), ip, userAgent: ua ?? null };
  }

  @ApiOperation({ summary: 'Create SMTP config' })
  @Post()
  create(
    @Body() dto: CreateSmtpDto,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.smtp.create(dto, this.ctx(user, ip, ua));
  }

  @ApiOperation({ summary: 'List SMTP configs' })
  @Get()
  list(@Query() query: ListQueryDto) {
    return this.smtp.list(query.page, query.limit);
  }

  @ApiOperation({ summary: 'Get SMTP config by id' })
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.smtp.findById(id);
  }

  @ApiOperation({ summary: 'Update SMTP config' })
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSmtpDto,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.smtp.update(id, dto, this.ctx(user, ip, ua));
  }

  @ApiOperation({ summary: 'Delete SMTP config' })
  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ): Promise<void> {
    await this.smtp.remove(id, this.ctx(user, ip, ua));
  }

  @ApiOperation({ summary: 'Activate SMTP config' })
  @Post(':id/activate')
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.smtp.activate(id, this.ctx(user, ip, ua));
  }

  @ApiOperation({ summary: 'Test SMTP config' })
  @Post(':id/test')
  test(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.smtp.test(id, this.ctx(user, ip, ua));
  }
}
