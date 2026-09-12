import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, or } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import {
  contactInteractions,
  contactRelationships,
  type ContactInteractionRow,
  type ContactRelationshipRow,
  type NewContactInteractionRow,
  type NewContactRelationshipRow,
} from '../../infrastructure/database/schema/contact.schema';

/** Relationships between contacts, and the interaction timeline. */
@Injectable()
export class ContactGraphRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  /**
   * Every edge touching a contact, in either direction.
   *
   * Edges are stored once and directed; symmetric types are rendered from
   * either side by the service. Storing both directions would double the rows
   * and let them disagree.
   */
  async relationshipsFor(contactId: string): Promise<ContactRelationshipRow[]> {
    return this.db
      .select()
      .from(contactRelationships)
      .where(
        and(
          or(
            eq(contactRelationships.fromContactId, contactId),
            eq(contactRelationships.toContactId, contactId),
          )!,
          eq(contactRelationships.isDeleted, false),
        ),
      );
  }

  async findRelationship(
    fromContactId: string,
    toContactId: string,
    type: ContactRelationshipRow['type'],
  ): Promise<ContactRelationshipRow | null> {
    const rows = await this.db
      .select()
      .from(contactRelationships)
      .where(
        and(
          eq(contactRelationships.fromContactId, fromContactId),
          eq(contactRelationships.toContactId, toContactId),
          eq(contactRelationships.type, type),
          eq(contactRelationships.isDeleted, false),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async createRelationship(
    values: NewContactRelationshipRow,
  ): Promise<ContactRelationshipRow> {
    const rows = await this.db
      .insert(contactRelationships)
      .values(values)
      .returning();
    return rows[0];
  }

  async removeRelationship(id: string): Promise<boolean> {
    const rows = await this.db
      .update(contactRelationships)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(
        and(
          eq(contactRelationships.id, id),
          eq(contactRelationships.isDeleted, false),
        ),
      )
      .returning({ id: contactRelationships.id });
    return rows.length > 0;
  }

  // --- interactions ---

  async listInteractions(
    contactId: string,
    page: number,
    limit: number,
  ): Promise<{ rows: ContactInteractionRow[]; total: number }> {
    const where = and(
      eq(contactInteractions.contactId, contactId),
      eq(contactInteractions.isDeleted, false),
    );
    const rows = await this.db
      .select()
      .from(contactInteractions)
      .where(where)
      .orderBy(desc(contactInteractions.occurredAt))
      .limit(limit)
      .offset((page - 1) * limit);
    const totals = await this.db
      .select({ value: count() })
      .from(contactInteractions)
      .where(where);
    return { rows, total: Number(totals[0]?.value ?? 0) };
  }

  async createInteraction(
    values: NewContactInteractionRow,
  ): Promise<ContactInteractionRow> {
    const rows = await this.db
      .insert(contactInteractions)
      .values(values)
      .returning();
    return rows[0];
  }

  /**
   * Record an email interaction at most once per message.
   *
   * A mailbox re-sync re-delivers the same message, so this leans on the
   * partial unique index over `email_message_id` instead of a read-then-write,
   * which would race two sync workers against each other.
   */
  async upsertEmailInteraction(
    values: NewContactInteractionRow & { emailMessageId: string },
  ): Promise<ContactInteractionRow | null> {
    const rows = await this.db
      .insert(contactInteractions)
      .values(values)
      .onConflictDoNothing()
      .returning();
    return rows[0] ?? null;
  }

  async findByEmailMessage(
    emailMessageId: string,
  ): Promise<ContactInteractionRow | null> {
    const rows = await this.db
      .select()
      .from(contactInteractions)
      .where(
        and(
          eq(contactInteractions.emailMessageId, emailMessageId),
          eq(contactInteractions.isDeleted, false),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async removeInteraction(id: string): Promise<boolean> {
    const rows = await this.db
      .update(contactInteractions)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(
        and(
          eq(contactInteractions.id, id),
          eq(contactInteractions.isDeleted, false),
        ),
      )
      .returning({ id: contactInteractions.id });
    return rows.length > 0;
  }
}
