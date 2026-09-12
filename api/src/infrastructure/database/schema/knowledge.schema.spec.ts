import {
  granteeType,
  knowledge,
  knowledgeAccessControl,
  knowledgeCategories,
  knowledgeContactLinks,
  knowledgePermission,
  knowledgeStatus,
  knowledgeTags,
  knowledgeTypes,
  knowledgeVisibility,
} from './knowledge.schema';

describe('knowledge schema', () => {
  it('defines the review lifecycle', () => {
    expect(knowledgeStatus.enumValues).toEqual([
      'draft',
      'in_review',
      'published',
      'archived',
      'deprecated',
    ]);
  });

  it('orders permissions from least to most capable', () => {
    expect(knowledgePermission.enumValues).toEqual([
      'read',
      'comment',
      'write',
      'manage',
    ]);
  });

  it('defaults a record to private', () => {
    expect(knowledgeVisibility.enumValues).toEqual([
      'private',
      'restricted',
      'internal',
    ]);
    expect(knowledge.visibility.default).toBe('private');
  });

  it('grants to users, roles or any authenticated caller', () => {
    expect(granteeType.enumValues).toEqual(['user', 'role', 'authenticated']);
  });

  it('exposes the five knowledge tables plus the contact link', () => {
    expect(knowledgeTypes).toBeDefined();
    expect(knowledgeCategories).toBeDefined();
    expect(knowledgeTags).toBeDefined();
    expect(knowledgeAccessControl).toBeDefined();
    expect(knowledgeContactLinks).toBeDefined();
  });
});
