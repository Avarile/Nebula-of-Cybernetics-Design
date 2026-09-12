import { Injectable } from '@nestjs/common';
import { EncryptionService } from '../../infrastructure/crypto/encryption.service';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import type { SmtpConfigRow } from '../../infrastructure/database/schema/system.schema';
import { verifySmtp } from '../../infrastructure/email/transport/smtp.transport';
import type { CreateSmtpDto } from './dto/create-smtp.dto';
import type { UpdateSmtpDto } from './dto/update-smtp.dto';
import { SmtpConfigRepository } from './smtp-config.repository';
import { SystemAuditService } from './system-audit.service';
import type { AuditContext } from './system-audit.types';

export interface PublicSmtpConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string | null;
  secure: boolean;
  fromAddress: string;
  fromName: string | null;
  isActive: boolean;
  hasSecret: boolean;
  lastTestedAt: Date | null;
  lastTestStatus: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class SmtpConfigService {
  constructor(
    private readonly repo: SmtpConfigRepository,
    private readonly crypto: EncryptionService,
    private readonly audit: SystemAuditService,
    private readonly errors: ExceptionService,
  ) {}

  private toPublic(row: SmtpConfigRow): PublicSmtpConfig {
    return {
      id: row.id,
      name: row.name,
      host: row.host,
      port: row.port,
      username: row.username ?? null,
      secure: row.secure,
      fromAddress: row.fromAddress,
      fromName: row.fromName ?? null,
      isActive: row.isActive,
      hasSecret: Boolean(row.secretEnc),
      lastTestedAt: row.lastTestedAt ?? null,
      lastTestStatus: row.lastTestStatus ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async getRow(id: string): Promise<SmtpConfigRow> {
    const row = await this.repo.findActiveById(id);
    if (!row)
      throw this.errors.create(ErrorCode.CONFIG_NOT_FOUND, {
        message: 'SMTP config not found',
      });
    return row;
  }

  async create(
    dto: CreateSmtpDto,
    ctx: AuditContext,
  ): Promise<PublicSmtpConfig> {
    const row = await this.repo.create({
      name: dto.name,
      host: dto.host,
      port: dto.port,
      username: dto.username,
      secretEnc: dto.secret ? this.crypto.encrypt(dto.secret) : null,
      secure: dto.secure,
      fromAddress: dto.fromAddress,
      fromName: dto.fromName,
    });
    await this.audit.record({
      ctx,
      action: 'smtp.create',
      entityType: 'smtp',
      entityId: row.id,
      metadata: { name: row.name, host: row.host },
    });
    return this.toPublic(row);
  }

  async findById(id: string): Promise<PublicSmtpConfig> {
    return this.toPublic(await this.getRow(id));
  }

  async list(page: number, limit: number) {
    const { rows, total } = await this.repo.list(page, limit);
    return { data: rows.map((r) => this.toPublic(r)), total, page, limit };
  }

  async update(
    id: string,
    dto: UpdateSmtpDto,
    ctx: AuditContext,
  ): Promise<PublicSmtpConfig> {
    const current = await this.getRow(id); // 404 if missing
    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.host !== undefined) patch.host = dto.host;
    if (dto.port !== undefined) patch.port = dto.port;
    if (dto.username !== undefined) patch.username = dto.username;
    if (dto.secure !== undefined) patch.secure = dto.secure;
    if (dto.fromAddress !== undefined) patch.fromAddress = dto.fromAddress;
    if (dto.fromName !== undefined) patch.fromName = dto.fromName;
    if (dto.secret !== undefined)
      patch.secretEnc = this.crypto.encrypt(dto.secret);

    if (Object.keys(patch).length === 0) {
      return this.toPublic(current);
    }

    const row = await this.repo.update(id, patch);
    if (!row)
      throw this.errors.create(ErrorCode.CONFIG_NOT_FOUND, {
        message: 'SMTP config not found',
      });
    await this.audit.record({
      ctx,
      action: 'smtp.update',
      entityType: 'smtp',
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
      action: 'smtp.delete',
      entityType: 'smtp',
      entityId: id,
    });
  }

  async activate(id: string, ctx: AuditContext): Promise<PublicSmtpConfig> {
    await this.getRow(id);
    const row = await this.repo.activate(id);
    if (!row)
      throw this.errors.create(ErrorCode.CONFIG_NOT_FOUND, {
        message: 'SMTP config not found',
      });
    await this.audit.record({
      ctx,
      action: 'smtp.activate',
      entityType: 'smtp',
      entityId: id,
    });
    return this.toPublic(row);
  }

  async test(
    id: string,
    ctx: AuditContext,
  ): Promise<{ ok: boolean; error?: string }> {
    const row = await this.getRow(id);
    try {
      await verifySmtp({
        host: row.host,
        port: row.port,
        secure: row.secure,
        username: row.username,
        password: row.secretEnc ? this.crypto.decrypt(row.secretEnc) : null,
        fromAddress: row.fromAddress,
        fromName: row.fromName,
      });
      await this.repo.stampTest(id, 'ok');
      await this.audit.record({
        ctx,
        action: 'smtp.test',
        entityType: 'smtp',
        entityId: id,
        metadata: { result: 'ok' },
      });
      return { ok: true };
    } catch (err) {
      await this.repo.stampTest(id, 'failed');
      const error = err instanceof Error ? err.message : String(err);
      await this.audit.record({
        ctx,
        action: 'smtp.test',
        entityType: 'smtp',
        entityId: id,
        metadata: { result: 'failed' },
      });
      return { ok: false, error };
    }
  }
}
