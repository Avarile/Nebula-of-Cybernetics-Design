import { BullModule } from '@nestjs/bullmq';
import { Module, type OnApplicationBootstrap } from '@nestjs/common';
import { QueueModule } from '../../infrastructure/queue/queue.module';
import { RetentionPurgeRegistry } from '../../infrastructure/retention/retention.registry';
import { RetentionRegistryModule } from '../../infrastructure/retention/retention-registry.module';
import { JobHandlerRegistryModule } from '../../infrastructure/scheduling/job-handler-registry.module';
import { ScheduledJobHandlerRegistry } from '../../infrastructure/scheduling/job-handler.registry';
import { CALENDAR_JOB_KINDS } from '../../infrastructure/database/schema/calendar.schema';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import {
  CalendarController,
  CalendarOccurrenceController,
} from './calendar.controller';
import { CalendarRepository } from './calendar.repository';
import { CalendarService } from './calendar.service';
import { DispatcherService } from './dispatcher.service';
import { EventReminderHandler } from './handlers/event-reminder.handler';
import { MaterializerService } from './materializer.service';
import { ReaperService } from './reaper.service';
import { SchedulingAdminController } from './scheduling-admin.controller';
import { SchedulingRepository } from './scheduling.repository';
import { SchedulingService } from './scheduling.service';
import { SCHEDULING_QUEUE } from './scheduling.constants';
import {
  SchedulingProcessor,
  SchedulingScheduler,
} from './schedulers/scheduling.scheduler';

/**
 * Calendar events, their occurrences, and the table-and-poller that fires the
 * work they imply.
 *
 * Two consumer surfaces, deliberately:
 *
 * **Over HTTP** — `CalendarController` (events, local-range reads),
 * `CalendarOccurrenceController` (single-instance overrides) and
 * `SchedulingAdminController` (health, dead letters, manual sweeps).
 *
 * **In process** — import this module and you get `SchedulingService` plus the
 * handler registry it re-exports. A module schedules and runs its own durable
 * work without the poller knowing it exists:
 *
 *   \@Module({ imports: [SchedulingModule] })
 *   export class FinanceModule implements OnApplicationBootstrap {
 *     onApplicationBootstrap() {
 *       this.handlers.register('invoice.chase', ({ job }) =>
 *         this.invoices.chase(job.subjectId!, job.payload));
 *     }
 *   }
 *
 *   // ...then, inside the transaction that issued the invoice:
 *   await this.scheduler.schedule({
 *     kind: 'invoice.chase',
 *     runAt: dueDate,
 *     dedupeKey: `invoice.chase:${invoice.id}:first`,
 *     subject: { type: 'invoice', id: invoice.id },
 *   }, tx);
 *
 *   // ...and when it is paid, in the transaction that recorded the payment:
 *   await this.scheduler.cancelFor('invoice', invoice.id, tx);
 *
 * Register the handler before anything schedules that kind: `schedule` refuses
 * a kind with no handler, which is the point, but it means a module that
 * schedules during its own bootstrap must register first.
 *
 * Registers its own retention purge and its own job handler — the sweep must
 * never import the modules whose rows it deletes, and the dispatcher must never
 * import the modules whose work it runs.
 */
@Module({
  imports: [
    UsersModule,
    NotificationsModule,
    QueueModule,
    RetentionRegistryModule,
    JobHandlerRegistryModule,
    BullModule.registerQueue({ name: SCHEDULING_QUEUE }),
  ],
  controllers: [
    CalendarController,
    CalendarOccurrenceController,
    SchedulingAdminController,
  ],
  providers: [
    CalendarRepository,
    SchedulingRepository,
    MaterializerService,
    DispatcherService,
    ReaperService,
    CalendarService,
    SchedulingService,
    EventReminderHandler,
    SchedulingScheduler,
    SchedulingProcessor,
  ],
  exports: [
    CalendarService,
    SchedulingService,
    // Re-exported as a module, not as a bare class: Nest only lets a module
    // export a token it provides or a module it imports. This is what makes
    // `imports: [SchedulingModule]` enough for a consumer to both register a
    // handler and schedule work, instead of two imports that must agree.
    JobHandlerRegistryModule,
  ],
})
export class SchedulingModule implements OnApplicationBootstrap {
  constructor(
    private readonly retention: RetentionPurgeRegistry,
    private readonly handlers: ScheduledJobHandlerRegistry,
    private readonly scheduler: SchedulingService,
    private readonly reminders: EventReminderHandler,
  ) {}

  onApplicationBootstrap(): void {
    this.handlers.register(CALENDAR_JOB_KINDS.reminder, (context) =>
      this.reminders.handle(context),
    );
    // Terminal rows only. `scheduled_job` is high-churn operational state, so
    // it is retained for 30 days rather than the uniform 120: without a purge
    // the table grows without bound, and with one it stays a working set rather
    // than an archive.
    this.retention.register('scheduled_job', (cutoff, limit) =>
      this.scheduler.purgeTerminalOlderThan(cutoff, limit),
    );
  }
}
