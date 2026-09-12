import {
  credentialKind,
  dataRetentionPolicies,
  eventSeverity,
  featureFlags,
  retentionAction,
  retentionEntityType,
  systemEventLog,
  systemSettingRevisions,
  imapConfigs,
  integrationCredentials,
  settingType,
  smtpConfigs,
  systemAuditLog,
  systemSettings,
} from './system.schema';

describe('system schema', () => {
  it('defines the credential_kind enum', () => {
    expect(credentialKind.enumValues).toEqual([
      'api_key',
      'oauth2',
      'basic',
      'bearer',
    ]);
  });

  it('defines the setting_type enum', () => {
    expect(settingType.enumValues).toEqual([
      'string',
      'number',
      'boolean',
      'json',
    ]);
  });

  it('exposes all system tables', () => {
    expect(smtpConfigs).toBeDefined();
    expect(imapConfigs).toBeDefined();
    expect(integrationCredentials).toBeDefined();
    expect(systemSettings).toBeDefined();
    expect(systemAuditLog).toBeDefined();
  });

  it('defines the event_severity enum', () => {
    expect(eventSeverity.enumValues).toEqual([
      'debug',
      'info',
      'warn',
      'error',
      'critical',
    ]);
  });

  it('governs retention for every high-volume table', () => {
    expect(retentionEntityType.enumValues).toEqual([
      'activity_log',
      'system_event_log',
      'notifications',
      'notification_delivery_attempts',
      'sessions',
      'password_reset_codes',
      'email_messages',
      'search_records',
      'scheduled_job',
    ]);
    expect(retentionAction.enumValues).toEqual([
      'purge',
      'anonymize',
      'archive',
    ]);
  });

  it('exposes the extended system tables', () => {
    expect(systemSettingRevisions).toBeDefined();
    expect(systemEventLog).toBeDefined();
    expect(dataRetentionPolicies).toBeDefined();
    expect(featureFlags).toBeDefined();
  });

  it('keeps the event log and setting history append-only', () => {
    expect('isDeleted' in systemEventLog).toBe(false);
    expect('isDeleted' in systemSettingRevisions).toBe(false);
  });

  it('makes settings editable by default but version-tracked', () => {
    expect(systemSettings.isEditable.default).toBe(true);
    expect(systemSettings.version.default).toBe(0);
  });
});
