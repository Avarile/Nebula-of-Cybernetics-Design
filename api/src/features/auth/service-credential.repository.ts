import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import {
  serviceCredentials,
  type NewServiceCredentialRow,
  type ServiceCredentialRow,
} from '../../infrastructure/database/schema/identity.schema';

@Injectable()
export class ServiceCredentialRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async create(row: NewServiceCredentialRow): Promise<ServiceCredentialRow> {
    const rows = await this.db
      .insert(serviceCredentials)
      .values(row)
      .returning();
    return rows[0];
  }

  /**
   * A credential that is still usable: exists, live, not revoked.
   *
   * The service-token counterpart of `SessionRepository.findLiveById` — a
   * service credential has no session, so its own row is the revocation record.
   * Expiry is checked by the caller, which owns the clock.
   */
  async findLiveById(id: string): Promise<ServiceCredentialRow | null> {
    const rows = await this.db
      .select()
      .from(serviceCredentials)
      .where(
        and(
          eq(serviceCredentials.id, id),
          eq(serviceCredentials.isDeleted, false),
          isNull(serviceCredentials.revokedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findByKeyHash(keyHash: string): Promise<ServiceCredentialRow | null> {
    const rows = await this.db
      .select()
      .from(serviceCredentials)
      .where(eq(serviceCredentials.keyHash, keyHash))
      .limit(1);
    return rows[0] ?? null;
  }

  async list(): Promise<ServiceCredentialRow[]> {
    return this.db
      .select()
      .from(serviceCredentials)
      .where(eq(serviceCredentials.isDeleted, false))
      .orderBy(desc(serviceCredentials.createdAt));
  }

  async revoke(id: string): Promise<void> {
    await this.db
      .update(serviceCredentials)
      .set({ revokedAt: new Date() })
      .where(eq(serviceCredentials.id, id));
  }

  async touch(id: string): Promise<void> {
    await this.db
      .update(serviceCredentials)
      .set({ lastUsedAt: new Date() })
      .where(eq(serviceCredentials.id, id));
  }
}
