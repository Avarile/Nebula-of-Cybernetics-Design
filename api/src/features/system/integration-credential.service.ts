import { Injectable } from '@nestjs/common';
import { EncryptionService } from '../../infrastructure/crypto/encryption.service';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import type { IntegrationCredentialRow } from '../../infrastructure/database/schema/system.schema';
import type { CreateIntegrationDto } from './dto/create-integration.dto';
import type { UpdateIntegrationDto } from './dto/update-integration.dto';
import { IntegrationCredentialRepository } from './integration-credential.repository';
import { SystemAuditService } from './system-audit.service';
import type { AuditContext } from './system-audit.types';

export interface PublicIntegrationCredential {
  id: string;
  provider: string;
  name: string;
  kind: IntegrationCredentialRow['kind'];
  meta: Record<string, unknown>;
  expiresAt: Date | null;
  isActive: boolean;
  hasSecret: boolean;
  lastUsedAt: Date | null;
  lastTestedAt: Date | null;
  lastTestStatus: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class IntegrationCredentialService {
  constructor(
    private readonly repo: IntegrationCredentialRepository,
    private readonly crypto: EncryptionService,
    private readonly audit: SystemAuditService,
    private readonly errors: ExceptionService,
  ) {}

  private toPublic(row: IntegrationCredentialRow): PublicIntegrationCredential {
    return {
      id: row.id,
      provider: row.provider,
      name: row.name,
      kind: row.kind,
      meta: row.meta,
      expiresAt: row.expiresAt ?? null,
      isActive: row.isActive,
      hasSecret: Boolean(row.secretEnc),
      lastUsedAt: row.lastUsedAt ?? null,
      lastTestedAt: row.lastTestedAt ?? null,
      lastTestStatus: row.lastTestStatus ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async getRow(id: string): Promise<IntegrationCredentialRow> {
    const row = await this.repo.findActiveById(id);
    if (!row)
      throw this.errors.create(ErrorCode.CONFIG_NOT_FOUND, {
        message: 'Integration credential not found',
      });
    return row;
  }

  async create(
    dto: CreateIntegrationDto,
    ctx: AuditContext,
  ): Promise<PublicIntegrationCredential> {
    if (await this.repo.findByProviderAndName(dto.provider, dto.name)) {
      throw this.errors.create(ErrorCode.CONFLICT, {
        message: `A credential named "${dto.name}" already exists for ${dto.provider}`,
      });
    }
    const row = await this.repo.create({
      provider: dto.provider,
      name: dto.name,
      kind: dto.kind,
      secretEnc: this.crypto.encrypt(dto.secret),
      meta: dto.meta,
      expiresAt: dto.expiresAt,
    });
    await this.audit.record({
      ctx,
      action: 'integration.create',
      entityType: 'integration',
      entityId: row.id,
      metadata: { provider: row.provider, name: row.name, kind: row.kind },
    });
    return this.toPublic(row);
  }

  async findById(id: string): Promise<PublicIntegrationCredential> {
    return this.toPublic(await this.getRow(id));
  }

  async list(q: { provider?: string; page: number; limit: number }) {
    const { rows, total } = await this.repo.list(q);
    return {
      data: rows.map((r) => this.toPublic(r)),
      total,
      page: q.page,
      limit: q.limit,
    };
  }

  async update(
    id: string,
    dto: UpdateIntegrationDto,
    ctx: AuditContext,
  ): Promise<PublicIntegrationCredential> {
    const current = await this.getRow(id);
    if (dto.provider !== undefined || dto.name !== undefined) {
      const provider = dto.provider ?? current.provider;
      const name = dto.name ?? current.name;
      const clash = await this.repo.findByProviderAndName(provider, name);
      if (clash && clash.id !== id) {
        throw this.errors.create(ErrorCode.CONFLICT, {
          message: `A credential named "${name}" already exists for ${provider}`,
        });
      }
    }
    const patch: Record<string, unknown> = {};
    if (dto.provider !== undefined) patch.provider = dto.provider;
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.kind !== undefined) patch.kind = dto.kind;
    if (dto.meta !== undefined) patch.meta = dto.meta;
    if (dto.expiresAt !== undefined) patch.expiresAt = dto.expiresAt;
    if (dto.secret !== undefined)
      patch.secretEnc = this.crypto.encrypt(dto.secret);

    if (Object.keys(patch).length === 0) {
      return this.toPublic(current);
    }

    const row = await this.repo.update(id, patch);
    if (!row)
      throw this.errors.create(ErrorCode.CONFIG_NOT_FOUND, {
        message: 'Integration credential not found',
      });
    await this.audit.record({
      ctx,
      action: 'integration.update',
      entityType: 'integration',
      entityId: id,
      metadata: { fields: Object.keys(patch).filter((k) => k !== 'secretEnc') },
    });
    return this.toPublic(row);
  }

  async remove(id: string, ctx: AuditContext): Promise<void> {
    await this.getRow(id);
    await this.repo.softDelete(id);
    await this.audit.record({
      ctx,
      action: 'integration.delete',
      entityType: 'integration',
      entityId: id,
    });
  }

  /**
   * Internal use only (NOT routed via HTTP): decrypt the stored secret so a
   * future consumer can call the 3rd-party API.
   */
  async getDecryptedSecret(id: string): Promise<string> {
    const row = await this.getRow(id);
    return this.crypto.decrypt(row.secretEnc);
  }
}
