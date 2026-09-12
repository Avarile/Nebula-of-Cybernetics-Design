import { Injectable } from '@nestjs/common';
import { EncryptionService } from '../../infrastructure/crypto/encryption.service';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import type { ImapConfigRow } from '../../infrastructure/database/schema/system.schema';
import { verifyImap } from '../../infrastructure/email/transport/imap.transport';
import type { CreateImapDto } from './dto/create-imap.dto';
import type { UpdateImapDto } from './dto/update-imap.dto';
import { ImapConfigRepository } from './imap-config.repository';
import { SystemAuditService } from './system-audit.service';
import type { AuditContext } from './system-audit.types';

export interface PublicImapConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string | null;
  secure: boolean;
  isActive: boolean;
  hasSecret: boolean;
  lastTestedAt: Date | null;
  lastTestStatus: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ImapConfigService {
  constructor(
    private readonly repo: ImapConfigRepository,
    private readonly crypto: EncryptionService,
    private readonly audit: SystemAuditService,
    private readonly errors: ExceptionService,
  ) {}

  private toPublic(row: ImapConfigRow): PublicImapConfig {
    return {
      id: row.id,
      name: row.name,
      host: row.host,
      port: row.port,
      username: row.username ?? null,
      secure: row.secure,
      isActive: row.isActive,
      hasSecret: Boolean(row.secretEnc),
      lastTestedAt: row.lastTestedAt ?? null,
      lastTestStatus: row.lastTestStatus ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async getRow(id: string): Promise<ImapConfigRow> {
    const row = await this.repo.findActiveById(id);
    if (!row)
      throw this.errors.create(ErrorCode.CONFIG_NOT_FOUND, {
        message: 'IMAP config not found',
      });
    return row;
  }

  async create(
    dto: CreateImapDto,
    ctx: AuditContext,
  ): Promise<PublicImapConfig> {
    const row = await this.repo.create({
      name: dto.name,
      host: dto.host,
      port: dto.port,
      username: dto.username,
      secretEnc: dto.secret ? this.crypto.encrypt(dto.secret) : null,
      secure: dto.secure,
    });
    await this.audit.record({
      ctx,
      action: 'imap.create',
      entityType: 'imap',
      entityId: row.id,
      metadata: { name: row.name, host: row.host },
    });
    return this.toPublic(row);
  }

  async findById(id: string): Promise<PublicImapConfig> {
    return this.toPublic(await this.getRow(id));
  }

  async list(page: number, limit: number) {
    const { rows, total } = await this.repo.list(page, limit);
    return { data: rows.map((r) => this.toPublic(r)), total, page, limit };
  }

  async update(
    id: string,
    dto: UpdateImapDto,
    ctx: AuditContext,
  ): Promise<PublicImapConfig> {
    const current = await this.getRow(id);
    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.host !== undefined) patch.host = dto.host;
    if (dto.port !== undefined) patch.port = dto.port;
    if (dto.username !== undefined) patch.username = dto.username;
    if (dto.secure !== undefined) patch.secure = dto.secure;
    if (dto.secret !== undefined)
      patch.secretEnc = this.crypto.encrypt(dto.secret);

    if (Object.keys(patch).length === 0) {
      return this.toPublic(current);
    }

    const row = await this.repo.update(id, patch);
    if (!row)
      throw this.errors.create(ErrorCode.CONFIG_NOT_FOUND, {
        message: 'IMAP config not found',
      });
    await this.audit.record({
      ctx,
      action: 'imap.update',
      entityType: 'imap',
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
      action: 'imap.delete',
      entityType: 'imap',
      entityId: id,
    });
  }

  async activate(id: string, ctx: AuditContext): Promise<PublicImapConfig> {
    await this.getRow(id);
    const row = await this.repo.activate(id);
    if (!row)
      throw this.errors.create(ErrorCode.CONFIG_NOT_FOUND, {
        message: 'IMAP config not found',
      });
    await this.audit.record({
      ctx,
      action: 'imap.activate',
      entityType: 'imap',
      entityId: id,
    });
    return this.toPublic(row);
  }

  /**
   * Connect to the configured server and report whether it worked.
   *
   * Note for the threat model: this is an authenticated, admin-only primitive
   * that makes the server open a connection to an admin-supplied host:port and
   * reports the outcome — i.e. an internal-network probe with a response
   * oracle. Acceptable because it is admin-only and the host is the very thing
   * being configured, but it is a capability, not just a convenience.
   */
  async test(
    id: string,
    ctx: AuditContext,
  ): Promise<{ ok: boolean; error?: string }> {
    const row = await this.getRow(id);
    try {
      await verifyImap({
        host: row.host,
        port: row.port,
        secure: row.secure,
        username: row.username,
        password: row.secretEnc ? this.crypto.decrypt(row.secretEnc) : null,
      });
      await this.repo.stampTest(id, 'ok');
      await this.audit.record({
        ctx,
        action: 'imap.test',
        entityType: 'imap',
        entityId: id,
        metadata: { result: 'ok' },
      });
      return { ok: true };
    } catch (err) {
      await this.repo.stampTest(id, 'failed');
      await this.audit.record({
        ctx,
        action: 'imap.test',
        entityType: 'imap',
        entityId: id,
        metadata: { result: 'failed' },
      });
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
