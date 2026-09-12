import {
  actorKind,
  activityLog,
  attachableType,
  commentableType,
  comments,
  entityAttachments,
  tagScope,
  tags,
} from './shared.schema';

describe('shared schema', () => {
  it('defines the tag_scope enum', () => {
    expect(tagScope.enumValues).toEqual([
      'knowledge',
      'contact',
      'project',
      'task',
      'shared',
    ]);
  });

  it('defines actor_kind without an anonymous arm', () => {
    // An anonymous caller cannot produce an activity row: every
    // activity-producing route requires authentication.
    expect(actorKind.enumValues).toEqual(['user', 'service', 'system']);
  });

  it('enumerates commentable and attachable entities', () => {
    expect(commentableType.enumValues).toContain('knowledge');
    expect(attachableType.enumValues).toContain('transaction');
  });

  it('exposes the cross-cutting tables', () => {
    expect(tags).toBeDefined();
    expect(comments).toBeDefined();
    expect(entityAttachments).toBeDefined();
    expect(activityLog).toBeDefined();
  });

  it('keeps activity_log append-only', () => {
    // A log row that can be soft-deleted is not a record of what happened.
    expect('isDeleted' in activityLog).toBe(false);
    expect('deletedAt' in activityLog).toBe(false);
  });
});
