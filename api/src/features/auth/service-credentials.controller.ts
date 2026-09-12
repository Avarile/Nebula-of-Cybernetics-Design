import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { userIdOrNull, type Principal } from '../../common/principal';
import { CreateServiceCredentialDto } from './dto/create-service-credential.dto';
import { ServiceCredentialService } from './service-credential.service';

/** Admin management of agent API keys. */
@ApiTags('Auth')
@Roles('admin')
@Controller('service-credentials')
export class ServiceCredentialsController {
  constructor(private readonly credentials: ServiceCredentialService) {}

  @ApiOperation({ summary: 'Issue service credential' })
  @Post()
  create(
    @Body() dto: CreateServiceCredentialDto,
    @CurrentUser() admin: Principal,
  ) {
    return this.credentials.issue(dto.name, userIdOrNull(admin));
  }

  @ApiOperation({ summary: 'List service credentials' })
  @Get()
  list() {
    return this.credentials.list();
  }

  @ApiOperation({ summary: 'Revoke service credential' })
  @Delete(':id')
  @HttpCode(204)
  async revoke(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.credentials.revoke(id);
  }
}
