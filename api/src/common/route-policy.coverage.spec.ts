// The Mastra controllers transitively pull in `@mastra/core`, whose cjs build
// eagerly requires the ESM-only `@sindresorhus/slugify` and dies under Jest.
// Only decorator metadata is read here, so the classes never run — stub the
// modules out, as the tool specs already do.
jest.mock('@mastra/nestjs', () => ({ MastraService: class {} }));
jest.mock('@mastra/core/tools', () => ({ createTool: jest.fn() }));
jest.mock('@mastra/core/request-context', () => ({ RequestContext: class {} }));

import { PATH_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from './decorators/public.decorator';
import { ROLES_KEY } from './decorators/roles.decorator';

import { AuthController } from '../features/auth/auth.controller';
import { ServiceCredentialsController } from '../features/auth/service-credentials.controller';
import { FileController } from '../features/file-processor/file.controller';
import { MailboxController } from '../features/mailbox/mailbox.controller';
import { ApprovalController } from '../features/mastra/controllers/approval.controller';
import { ChatController } from '../features/mastra/controllers/chat.controller';
import { ScheduleController } from '../features/mastra/controllers/schedule.controller';
import { CollectionController } from '../features/search-service/collection.controller';
import { RecordController } from '../features/search-service/record.controller';
import { SearchQueryController } from '../features/search-service/search.controller';
import { SearchStatusController } from '../features/search-service/search-status.controller';
import { RbacController } from '../features/authorization/rbac.controller';
import { ContactCompanyController } from '../features/contacts/contact-company.controller';
import { ContactVocabularyController } from '../features/contacts/contact-vocabulary.controller';
import { ContactController } from '../features/contacts/contact.controller';
import { KnowledgeVocabularyController } from '../features/knowledge/knowledge-vocabulary.controller';
import { KnowledgeController } from '../features/knowledge/knowledge.controller';
import { FinanceController } from '../features/finance/finance.controller';
import { InvoiceController } from '../features/finance/invoice.controller';
import {
  NotificationAdminController,
  NotificationController,
} from '../features/notifications/notification.controller';
import { ProjectController } from '../features/projects/project.controller';
import {
  CalendarController,
  CalendarOccurrenceController,
} from '../features/scheduling/calendar.controller';
import { SchedulingAdminController } from '../features/scheduling/scheduling-admin.controller';
import { TaskController } from '../features/projects/task.controller';
import { ActivityController } from '../features/shared/activity.controller';
import { AttachmentController } from '../features/shared/attachment.controller';
import { CommentController } from '../features/shared/comment.controller';
import { TagController } from '../features/shared/tag.controller';
import { FeatureFlagController } from '../features/system/feature-flag.controller';
import { ImapConfigController } from '../features/system/imap-config.controller';
import { RetentionController } from '../features/system/retention.controller';
import { SystemEventController } from '../features/system/system-event.controller';
import { IntegrationCredentialController } from '../features/system/integration-credential.controller';
import { SmtpConfigController } from '../features/system/smtp-config.controller';
import { SystemAuditController } from '../features/system/system-audit.controller';
import { SystemSettingsController } from '../features/system/system-settings.controller';
import {
  ProfileController,
  UserProfileAdminController,
} from '../features/users/profile.controller';
import { UsersController } from '../features/users/users.controller';
import { HealthController } from '../infrastructure/health/health.controller';

/**
 * Every first-party controller in the application.
 *
 * `assertEveryRouteDeclaresPolicy` performs the same check at boot over the live
 * module graph, which is authoritative — but it needs Postgres, Redis, MinIO and
 * Meili to be reachable, so it only fails on a real start. This runs the check
 * statically in the unit suite, where a missing `@Roles` is caught in seconds.
 *
 * A new controller must be added here. If that feels like duplication: the boot
 * audit is the guarantee, this is the fast feedback.
 */
const CONTROLLERS = [
  AuthController,
  ServiceCredentialsController,
  FileController,
  MailboxController,
  ApprovalController,
  ChatController,
  ScheduleController,
  CollectionController,
  RecordController,
  SearchQueryController,
  SearchStatusController,
  ImapConfigController,
  IntegrationCredentialController,
  SmtpConfigController,
  SystemAuditController,
  SystemSettingsController,
  FeatureFlagController,
  RetentionController,
  SystemEventController,
  TagController,
  CommentController,
  AttachmentController,
  ActivityController,
  RbacController,
  ContactController,
  ContactCompanyController,
  ContactVocabularyController,
  KnowledgeController,
  KnowledgeVocabularyController,
  ProjectController,
  TaskController,
  CalendarController,
  CalendarOccurrenceController,
  SchedulingAdminController,
  NotificationController,
  NotificationAdminController,
  FinanceController,
  InvoiceController,
  ProfileController,
  UserProfileAdminController,
  UsersController,
  HealthController,
];

function undeclaredRoutesOf(controller: new (...args: never[]) => object) {
  const prototype = controller.prototype as Record<string, unknown>;
  const classDeclared =
    Reflect.getMetadata(ROLES_KEY, controller) !== undefined ||
    Reflect.getMetadata(IS_PUBLIC_KEY, controller) !== undefined;

  return Object.getOwnPropertyNames(prototype)
    .filter((name) => name !== 'constructor')
    .filter((name) => typeof prototype[name] === 'function')
    .filter(
      (name) =>
        Reflect.getMetadata(PATH_METADATA, prototype[name] as object) !==
        undefined,
    )
    .filter((name) => {
      if (classDeclared) return false;
      const handler = prototype[name] as object;
      return (
        Reflect.getMetadata(ROLES_KEY, handler) === undefined &&
        Reflect.getMetadata(IS_PUBLIC_KEY, handler) === undefined
      );
    })
    .map((name) => `${controller.name}.${name}`);
}

describe('route policy coverage', () => {
  it.each(CONTROLLERS.map((c) => [c.name, c] as const))(
    '%s declares @Roles or @Public on every route',
    (_name, controller) => {
      expect(undeclaredRoutesOf(controller as never)).toEqual([]);
    },
  );

  // Guards the guard: if the detector stopped detecting, every case above would
  // pass vacuously and the suite would be worthless.
  it('detects an undeclared route', () => {
    class Undeclared {
      leaky() {
        return 'x';
      }
    }
    Reflect.defineMetadata(PATH_METADATA, '/', Undeclared.prototype.leaky);
    expect(undeclaredRoutesOf(Undeclared as never)).toEqual([
      'Undeclared.leaky',
    ]);
  });
});
