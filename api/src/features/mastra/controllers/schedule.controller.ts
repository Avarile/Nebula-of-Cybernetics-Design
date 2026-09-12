import { Body, Controller, Delete, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CreateScheduleDto } from '../dto/schedule.dto';
import { ScheduleService } from '../services/schedule.service';

@ApiTags('Agent')
@Controller('agent/schedules')
@Roles('admin')
export class ScheduleController {
  constructor(private readonly schedules: ScheduleService) {}

  @ApiOperation({ summary: 'Create agent schedule' })
  @Post()
  create(@Body() dto: CreateScheduleDto) {
    return this.schedules.create(dto);
  }

  @ApiOperation({ summary: 'Delete agent schedule' })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.schedules.remove(id);
  }
}
