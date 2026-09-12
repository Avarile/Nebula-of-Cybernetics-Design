import {
  knowledgeRelation,
  projectContactLinks,
  projectContactRelationship,
  projectKnowledgeLinks,
  timeEntries,
} from './project-link.schema';

describe('project link schema', () => {
  it('describes how knowledge and contacts relate to a project', () => {
    expect(knowledgeRelation.enumValues).toEqual([
      'reference',
      'requirement',
      'deliverable',
      'background',
    ]);
    expect(projectContactRelationship.enumValues).toContain('client');
  });

  it('exposes the link tables', () => {
    expect(projectKnowledgeLinks).toBeDefined();
    expect(projectContactLinks).toBeDefined();
  });

  it('locks billed time behind an invoice line item', () => {
    // Presence of this FK is what stops one hour being billed twice.
    expect(timeEntries.invoiceLineItemId).toBeDefined();
    expect(timeEntries.minutes.notNull).toBe(true);
    expect(timeEntries.workDate.notNull).toBe(true);
  });
});
