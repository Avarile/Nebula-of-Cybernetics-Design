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
import { RequirePermission } from '../authorization/require-permission.decorator';
import {
  AddLineItemDto,
  BillTimeDto,
  CreateInvoiceDto,
  ListInvoicesDto,
  RecordPaymentDto,
} from './dto/finance.dto';
import { InvoiceService } from './invoice.service';
import { PaymentService } from './payment.service';

/**
 * Invoicing.
 *
 * An invoice is mutable only while it is a draft; issuing it allocates a
 * gapless number and freezes it, because it becomes a document someone else
 * holds a copy of.
 */
@ApiTags('Finance')
@Controller('invoices')
export class InvoiceController {
  constructor(
    private readonly invoices: InvoiceService,
    private readonly payments: PaymentService,
  ) {}

  @ApiOperation({ summary: 'List invoices' })
  @Get()
  @Roles('user', 'admin')
  @RequirePermission('finance.read')
  list(@Query() query: ListInvoicesDto) {
    return this.invoices.list(query);
  }

  @ApiOperation({ summary: 'Create a draft invoice' })
  @Post()
  @Roles('user', 'admin')
  @RequirePermission('finance.invoice.manage')
  create(@Body() dto: CreateInvoiceDto, @CurrentUser() principal: Principal) {
    return this.invoices.create(dto, principal);
  }

  @ApiOperation({ summary: 'Overdue invoices' })
  @Get('overdue')
  @Roles('user', 'admin')
  @RequirePermission('finance.read')
  overdue() {
    return this.invoices.overdue();
  }

  @ApiOperation({ summary: 'An invoice with its lines and payments' })
  @Get(':id')
  @Roles('user', 'admin')
  @RequirePermission('finance.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.detail(id);
  }

  @ApiOperation({ summary: 'Add a line item' })
  @Post(':id/lines')
  @Roles('user', 'admin')
  @RequirePermission('finance.invoice.manage')
  addLine(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddLineItemDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.invoices.addLineItem(id, dto, principal);
  }

  @ApiOperation({ summary: 'Remove a line item' })
  @Delete(':id/lines/:lineId')
  @Roles('user', 'admin')
  @RequirePermission('finance.invoice.manage')
  @HttpCode(204)
  async removeLine(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
  ): Promise<void> {
    await this.invoices.removeLineItem(id, lineId);
  }

  @ApiOperation({ summary: 'Bill logged time onto an invoice' })
  @Post(':id/bill-time')
  @Roles('user', 'admin')
  @RequirePermission('finance.invoice.manage')
  billTime(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BillTimeDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.invoices.billTime(id, dto, principal);
  }

  @ApiOperation({ summary: 'Issue an invoice' })
  @Post(':id/issue')
  @Roles('user', 'admin')
  @RequirePermission('finance.invoice.manage')
  issue(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
  ) {
    return this.invoices.issue(id, principal);
  }

  @ApiOperation({ summary: 'Void an invoice' })
  @Post(':id/void')
  @Roles('user', 'admin')
  @RequirePermission('finance.invoice.manage')
  void(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
  ) {
    return this.invoices.void(id, principal);
  }

  @ApiOperation({ summary: 'Record a payment' })
  @Post(':id/payments')
  @Roles('user', 'admin')
  @RequirePermission('finance.invoice.manage')
  recordPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordPaymentDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.payments.recordPayment(id, dto, principal);
  }
}
