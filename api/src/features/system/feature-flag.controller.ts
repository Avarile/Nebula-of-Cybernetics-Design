import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { UpsertFeatureFlagDto } from './dto/feature-flag.dto';
import { FeatureFlagService } from './feature-flag.service';

/** Feature flags — admin-only, since a flag is a release control. */
@ApiTags('System')
@Roles('admin')
@Controller('system/feature-flags')
export class FeatureFlagController {
  constructor(private readonly flags: FeatureFlagService) {}

  @ApiOperation({ summary: 'List feature flags' })
  @Get()
  list() {
    return this.flags.list();
  }

  @ApiOperation({ summary: 'Get a feature flag' })
  @Get(':key')
  get(@Param('key') key: string) {
    return this.flags.get(key);
  }

  @ApiOperation({ summary: 'Create or update a feature flag' })
  @Put(':key')
  upsert(@Param('key') key: string, @Body() dto: UpsertFeatureFlagDto) {
    return this.flags.upsert(key, dto);
  }

  @ApiOperation({ summary: 'Delete a feature flag' })
  @Delete(':key')
  @HttpCode(204)
  async remove(@Param('key') key: string): Promise<void> {
    await this.flags.remove(key);
  }
}
