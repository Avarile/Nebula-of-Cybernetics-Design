import { Module } from '@nestjs/common';
import { ContactsModule } from '../contacts/contacts.module';
import { ProjectsModule } from '../projects/projects.module';
import { SharedModule } from '../shared/shared.module';
import { SystemModule } from '../system/system.module';
import { BudgetService } from './budget.service';
import { FinanceController } from './finance.controller';
import { FinanceRepository } from './finance.repository';
import { InvoiceController } from './invoice.controller';
import { InvoiceRepository } from './invoice.repository';
import { InvoiceService } from './invoice.service';
import { LedgerRepository } from './ledger.repository';
import { LedgerService } from './ledger.service';
import { PaymentService } from './payment.service';
import { RecurringService } from './recurring.service';

/**
 * Operational finance: accounts, the ledger, budgets, recurring income and
 * expenses, invoicing and payments.
 *
 * Depends on `ProjectsModule` for billable time and `ContactsModule` for the
 * bill-to snapshot. Both are READ through their services, so the scope rules
 * that guard them apply — `ProjectLinkService.unbilledFor` enforces project
 * membership, which the repository cannot because it never sees a principal.
 * `ProjectLinkRepository` is injected alongside it purely for the writes that
 * must join a finance transaction (`markBilled`, `releaseBilled`); reading
 * through it is how `bill-time` came to bypass membership entirely.
 */
@Module({
  imports: [SharedModule, ContactsModule, ProjectsModule, SystemModule],
  controllers: [FinanceController, InvoiceController],
  providers: [
    FinanceRepository,
    LedgerRepository,
    InvoiceRepository,
    LedgerService,
    BudgetService,
    InvoiceService,
    PaymentService,
    RecurringService,
  ],
  exports: [
    LedgerService,
    BudgetService,
    InvoiceService,
    PaymentService,
    RecurringService,
  ],
})
export class FinanceModule {}
