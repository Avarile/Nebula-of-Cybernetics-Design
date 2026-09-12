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
import { RequirePermission } from '../authorization/require-permission.decorator';
import { ContactCompanyService } from './contact-company.service';
import {
  CreateCompanyDto,
  ListCompaniesDto,
  UpdateCompanyDto,
} from './dto/company.dto';

/** Organizations. Shared reference data, readable by any authenticated caller. */
@ApiTags('Contacts')
@Controller('companies')
export class ContactCompanyController {
  constructor(private readonly companies: ContactCompanyService) {}

  @ApiOperation({ summary: 'List companies' })
  @Get()
  @Roles('user', 'admin', 'agent')
  @RequirePermission('contact.read')
  list(@Query() query: ListCompaniesDto) {
    return this.companies.list(query);
  }

  @ApiOperation({ summary: 'Create a company' })
  @Post()
  @Roles('user', 'admin')
  @RequirePermission('contact.create')
  create(@Body() dto: CreateCompanyDto, @CurrentUser() principal: Principal) {
    return this.companies.create(dto, principal);
  }

  @ApiOperation({ summary: 'Get a company' })
  @Get(':id')
  @Roles('user', 'admin', 'agent')
  @RequirePermission('contact.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.companies.get(id);
  }

  @ApiOperation({ summary: 'Update a company' })
  @Patch(':id')
  @Roles('user', 'admin')
  @RequirePermission('contact.update')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCompanyDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.companies.update(id, dto, principal);
  }

  @ApiOperation({ summary: 'Delete a company' })
  @Delete(':id')
  @Roles('admin')
  @RequirePermission('contact.delete')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
  ): Promise<void> {
    await this.companies.remove(id, principal);
  }
}
