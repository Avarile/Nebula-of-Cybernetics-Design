import {
  contactCategories,
  contactChannels,
  contactCompanies,
  contactInteractions,
  contactRelationships,
  contactStatus,
  contactTags,
  contactTypes,
  contactVisibility,
  contacts,
} from './contact.schema';

describe('contact schema', () => {
  it('defines the contact status vocabulary', () => {
    expect(contactStatus.enumValues).toEqual([
      'active',
      'inactive',
      'archived',
      'do_not_contact',
    ]);
  });

  it('defaults a contact to private', () => {
    expect(contactVisibility.enumValues).toEqual(['private', 'shared']);
    expect(contacts.visibility.default).toBe('private');
  });

  it('carries a normalized email for automatic deduplication', () => {
    // Uniqueness on this column is what makes an ingest meeting a known address
    // upsert the existing contact instead of creating a twin.
    expect(contacts.emailNormalized).toBeDefined();
  });

  it('exposes the CRM tables', () => {
    expect(contactTypes).toBeDefined();
    expect(contactCategories).toBeDefined();
    expect(contactCompanies).toBeDefined();
    expect(contactChannels).toBeDefined();
    expect(contactTags).toBeDefined();
    expect(contactRelationships).toBeDefined();
    expect(contactInteractions).toBeDefined();
  });

  it('records the event time of an interaction separately from the row time', () => {
    expect(contactInteractions.occurredAt.notNull).toBe(true);
  });
});
