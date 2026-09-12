import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import type { Principal } from '../../../common/principal';
import { DecisionDto } from '../dto/approval.dto';
import { ApprovalService } from '../services/approval.service';

@ApiTags('Agent')
// See ChatController: approvals are user-owned, so machine callers are excluded.
@Roles('user', 'admin')
@Controller('agent/approvals')
export class ApprovalController {
  constructor(private readonly approvals: ApprovalService) {}

  @ApiOperation({ summary: 'List pending approvals' })
  @Get()
  list(@CurrentUser() user: Principal) {
    return this.approvals.listForOwner(user);
  }

  @ApiOperation({ summary: 'Approve or reject a request' })
  @Post(':id')
  decide(
    @CurrentUser() user: Principal,
    @Param('id') id: string,
    @Body() dto: DecisionDto,
  ) {
    return this.approvals.decide(user, id, dto);
  }
}
