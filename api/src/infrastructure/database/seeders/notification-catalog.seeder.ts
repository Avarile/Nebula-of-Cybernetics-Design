import type { DrizzleDB } from '../drizzle.constants';
import {
  notificationEventTypes,
  notificationTemplates,
} from '../schema/notification.schema';
import type { Seeder } from './seeder.interface';
import { insertMissingByKey } from './seed.util';

/**
 * Every event the application may notify about. Emitting an event key that is
 * not in this table is a boot-time failure, not a silently undelivered email.
 *
 * `isMandatory` marks security and transactional mail a user may not switch
 * off — without it, an opt-out would disable password-reset delivery.
 */
const EVENT_TYPES = [
  // security / transactional — not opt-outable
  {
    key: 'auth.password_reset',
    name: 'Password reset code',
    category: 'security',
    isMandatory: true,
    isDigestable: false,
    defaultTemplateKey: 'auth.password_reset',
  },
  {
    key: 'auth.password_changed',
    name: 'Password changed',
    category: 'security',
    isMandatory: true,
    isDigestable: false,
    defaultTemplateKey: 'auth.password_changed',
  },
  {
    key: 'user.welcome',
    name: 'Welcome / account created',
    category: 'security',
    isMandatory: true,
    isDigestable: false,
    defaultTemplateKey: 'user.welcome',
  },
  // project
  {
    key: 'task.assigned',
    name: 'Task assigned to you',
    category: 'project',
    defaultTemplateKey: 'task.assigned',
  },
  {
    key: 'task.status_changed',
    name: 'Task status changed',
    category: 'project',
  },
  {
    key: 'task.mentioned',
    name: 'You were mentioned',
    category: 'project',
    isDigestable: false,
  },
  {
    key: 'task.due_soon',
    name: 'Task due soon',
    category: 'project',
    defaultTemplateKey: 'task.due_soon',
  },
  {
    key: 'project.member_added',
    name: 'Added to a project',
    category: 'project',
  },
  { key: 'project.due_soon', name: 'Project due soon', category: 'project' },
  { key: 'milestone.reached', name: 'Milestone reached', category: 'project' },
  { key: 'goal.at_risk', name: 'Goal at risk', category: 'project' },
  // knowledge
  {
    key: 'knowledge.review_due',
    name: 'Knowledge review due',
    category: 'knowledge',
  },
  {
    key: 'knowledge.shared',
    name: 'Knowledge shared with you',
    category: 'knowledge',
  },
  // crm
  {
    key: 'contact.follow_up_due',
    name: 'Contact follow-up due',
    category: 'crm',
  },
  // finance
  { key: 'invoice.sent', name: 'Invoice sent', category: 'finance' },
  {
    key: 'invoice.overdue',
    name: 'Invoice overdue',
    category: 'finance',
    isDigestable: false,
  },
  { key: 'payment.received', name: 'Payment received', category: 'finance' },
  {
    key: 'budget.threshold_reached',
    name: 'Budget threshold reached',
    category: 'finance',
    isDigestable: false,
  },
  {
    key: 'income.expected',
    name: 'Expected income due',
    category: 'finance',
  },
  // calendar
  {
    key: 'calendar.event_reminder',
    name: 'Event reminder',
    category: 'calendar',
    // A reminder that arrives in tomorrow's digest is not a reminder.
    isDigestable: false,
    defaultTemplateKey: 'calendar.event_reminder',
  },
];

/**
 * Starter templates. Rendering is logic-less `{{ variable }}` substitution, so
 * these are data an admin can reword without a deploy. Events with no template
 * seeded here get one alongside the feature that emits them — a missing
 * template fails loudly at enqueue rather than sending an empty email.
 */
const TEMPLATES = [
  {
    key: 'auth.password_reset',
    name: 'Password reset code',
    subjectTemplate: 'Your password reset code',
    bodyTextTemplate:
      'Hi {{displayName}},\n\nYour password reset code is {{code}}.\n' +
      'It expires in {{expiryMinutes}} minutes.\n\n' +
      'If you did not request this, you can ignore this email.',
    variables: {
      displayName: 'string',
      code: 'string',
      expiryMinutes: 'number',
    },
  },
  {
    key: 'auth.password_changed',
    name: 'Password changed',
    subjectTemplate: 'Your password was changed',
    bodyTextTemplate:
      'Hi {{displayName}},\n\nYour password was changed on {{changedAt}}.\n' +
      'Every existing session was signed out.\n\n' +
      'If this was not you, contact an administrator immediately.',
    variables: { displayName: 'string', changedAt: 'string' },
  },
  {
    key: 'user.welcome',
    name: 'Welcome',
    subjectTemplate: 'Your account is ready',
    bodyTextTemplate:
      'Hi {{displayName}},\n\nAn account has been created for you at {{appUrl}}.\n' +
      'Sign in with {{email}}.',
    variables: { displayName: 'string', email: 'string', appUrl: 'string' },
  },
  {
    key: 'task.assigned',
    name: 'Task assigned',
    subjectTemplate: '[{{projectKey}}-{{taskNumber}}] {{taskTitle}}',
    bodyTextTemplate:
      'Hi {{displayName}},\n\n{{assignerName}} assigned you a task in {{projectName}}:\n\n' +
      '{{projectKey}}-{{taskNumber}}: {{taskTitle}}\n' +
      'Due: {{dueDate}}\nPriority: {{priority}}\n\n{{taskUrl}}',
    variables: {
      displayName: 'string',
      assignerName: 'string',
      projectName: 'string',
      projectKey: 'string',
      taskNumber: 'number',
      taskTitle: 'string',
      dueDate: 'string',
      priority: 'string',
      taskUrl: 'string',
    },
  },
  {
    key: 'task.due_soon',
    name: 'Task due soon',
    subjectTemplate: 'Due {{dueDate}}: {{taskTitle}}',
    bodyTextTemplate:
      'Hi {{displayName}},\n\n{{projectKey}}-{{taskNumber}} ({{taskTitle}}) ' +
      'is due on {{dueDate}}.\n\n{{taskUrl}}',
    variables: {
      displayName: 'string',
      projectKey: 'string',
      taskNumber: 'number',
      taskTitle: 'string',
      dueDate: 'string',
      taskUrl: 'string',
    },
  },
  {
    key: 'calendar.event_reminder',
    name: 'Event reminder',
    subjectTemplate: 'Reminder: {{title}} at {{startLocal}}',
    bodyTextTemplate:
      'Hi {{displayName}},\n\n{{title}} starts at {{startLocal}} ({{timezone}}), ' +
      'in about {{minutesBefore}} minutes.\n{{location}}',
    variables: {
      displayName: 'string',
      title: 'string',
      startLocal: 'string',
      timezone: 'string',
      minutesBefore: 'number',
      location: 'string',
    },
  },
];

export class NotificationCatalogSeeder implements Seeder {
  readonly name = 'notification-catalog';

  async run(db: DrizzleDB): Promise<void> {
    const eventCount = await insertMissingByKey(
      db,
      notificationEventTypes,
      notificationEventTypes.key,
      EVENT_TYPES.map((e) => ({
        key: e.key,
        name: e.name,
        category: e.category,
        isMandatory: e.isMandatory ?? false,
        isDigestable: e.isDigestable ?? true,
        defaultEnabled: true,
        defaultTemplateKey: e.defaultTemplateKey ?? null,
        isSystem: true,
      })),
      (r) => r.key,
    );

    const templateCount = await insertMissingByKey(
      db,
      notificationTemplates,
      notificationTemplates.key,
      TEMPLATES.map((t) => ({
        key: t.key,
        locale: 'en',
        channel: 'email' as const,
        name: t.name,
        subjectTemplate: t.subjectTemplate,
        bodyTextTemplate: t.bodyTextTemplate,
        variables: t.variables,
        isActive: true,
      })),
      (r) => r.key,
    );

    console.log(
      `  ↳ notification event types +${eventCount}, templates +${templateCount}`,
    );
  }
}
