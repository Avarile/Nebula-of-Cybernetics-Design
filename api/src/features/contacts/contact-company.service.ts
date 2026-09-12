import { Injectable } from '@nestjs/common';
import { userIdOrNull, type Principal } from '../../common/principal';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import type { ContactCompanyRow } from '../../infrastructure/database/schema/contact.schema';
import { ActivityService } from '../shared/activity.service';
import { EntityCascadeService } from '../shared/entity-cascade.service';
import {
  ContactCompanyRepository,
  type CompanyQuery,
} from './contact-company.repository';
import type { CreateCompanyDto, UpdateCompanyDto } from './dto/company.dto';

/**
 * Organizations.
 *
 * Deliberately not owner-scoped the way contacts are: a company is reference
 * data the whole business shares, and hiding it per-owner would mean two
 * salespeople creating the same account twice.
 */
@Injectable()
export class ContactCompanyService {
  constructor(
    private readonly repo: ContactCompanyRepository,
    private readonly activity: ActivityService,
    private readonly cascade: EntityCascadeService,
    private readonly errors: ExceptionService,
  ) {}

  async create(
    dto: CreateCompanyDto,
    principal: Principal,
  ): Promise<ContactCompanyRow> {
    const domain = dto.domain?.trim().toLowerCase() || undefined;
    if (domain) {
      const clash = await this.repo.findByDomain(domain);
      if (clash) {
        throw this.errors.create(ErrorCode.CONFLICT, {
          message: `A company already claims the domain "${domain}"`,
        });
      }
    }
    const row = await this.repo.create({
      ...dto,
      domain,
      ownerUserId: userIdOrNull(principal),
    });
    await this.activity.recordSafe({
      principal,
      entityType: 'contact_company',
      entityId: row.id,
      action: 'company.created',
      summary: row.name,
    });
    return row;
  }

  async list(q: CompanyQuery) {
    const { rows, total } = await this.repo.list(q);
    return { data: rows, total, page: q.page, limit: q.limit };
  }

  async get(id: string): Promise<ContactCompanyRow> {
    const row = await this.repo.findLiveById(id);
    if (!row) throw this.errors.create(ErrorCode.NOT_FOUND);
    return row;
  }

  /** Resolve an email domain to a company — used when ingesting contacts. */
  async findByDomain(domain: string): Promise<ContactCompanyRow | null> {
    return this.repo.findByDomain(domain);
  }

  async update(
    id: string,
    dto: UpdateCompanyDto,
    principal: Principal,
  ): Promise<ContactCompanyRow> {
    await this.get(id);
    const domain = dto.domain?.trim().toLowerCase();
    if (domain) {
      const clash = await this.repo.findByDomain(domain);
      if (clash && clash.id !== id) {
        throw this.errors.create(ErrorCode.CONFLICT, {
          message: `A company already claims the domain "${domain}"`,
        });
      }
    }
    const row = await this.repo.update(id, { ...dto, domain });
    if (!row) throw this.errors.create(ErrorCode.NOT_FOUND);
    await this.activity.recordSafe({
      principal,
      entityType: 'contact_company',
      entityId: id,
      action: 'company.updated',
    });
    return row;
  }

  async remove(id: string, principal: Principal): Promise<void> {
    await this.get(id);
    await this.repo.softDelete(id);
    await this.cascade.purgeFor('contact', id);
    await this.activity.recordSafe({
      principal,
      entityType: 'contact_company',
      entityId: id,
      action: 'company.deleted',
    });
  }

  /** Companies are readable by any authenticated principal. */
  canRead(): Promise<boolean> {
    return Promise.resolve(true);
  }
}
