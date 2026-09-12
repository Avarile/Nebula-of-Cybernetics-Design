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
import { CreateIntegrationDto } from './dto/create-integration.dto';
import {
  IntegrationQueryDto,
  UpdateIntegrationDto,
} from './dto/update-integration.dto';
import { IntegrationCredentialService } from './integration-credential.service';
import type { AuditContext } from './system-audit.types';

@Roles('admin')
@ApiTags('System')
@Controller('system/integrations')
export class IntegrationCredentialController {
  constructor(private readonly integrations: IntegrationCredentialService) {}

  private ctx(user: Principal, ip: string, ua?: string): AuditContext {
    return { actorId: userIdOrNull(user), ip, userAgent: ua ?? null };
  }

  @ApiOperation({ summary: 'Create integration credential' })
  @Post()
  create(
    @Body() dto: CreateIntegrationDto,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.integrations.create(dto, this.ctx(user, ip, ua));
  }

  @ApiOperation({ summary: 'List integration credentials' })
  @Get()
  list(@Query() query: IntegrationQueryDto) {
    return this.integrations.list(query);
  }

  @ApiOperation({ summary: 'Get integration credential by id' })
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.integrations.findById(id);
  }

  @ApiOperation({ summary: 'Update integration credential' })
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateIntegrationDto,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.integrations.update(id, dto, this.ctx(user, ip, ua));
  }

  @ApiOperation({ summary: 'Delete integration credential' })
  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ): Promise<void> {
    await this.integrations.remove(id, this.ctx(user, ip, ua));
  }
}
