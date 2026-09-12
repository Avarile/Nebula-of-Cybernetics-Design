import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { ServiceCredentialRow } from '../../infrastructure/database/schema/identity.schema';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import { ServiceCredentialRepository } from './service-credential.repository';
import { SessionRevocationService } from './session-revocation.service';
import { TokenService } from './token.service';

/** Returned once, on creation — the only time the plaintext key is available. */
export interface IssuedCredential {
  id: string;
  name: string;
  keyPrefix: string;
  apiKey: string;
}

/** Public view of a credential (never includes the key/hash). */
export interface PublicCredential {
  id: string;
  name: string;
  keyPrefix: string;
  role: ServiceCredentialRow['role'];
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

@Injectable()
export class ServiceCredentialService {
  constructor(
    private readonly repo: ServiceCredentialRepository,
    private readonly tokens: TokenService,
    private readonly revocation: SessionRevocationService,
    private readonly errors: ExceptionService,
  ) {}

  async issue(
    name: string,
    createdBy: string | null,
  ): Promise<IssuedCredential> {
    const prefixBytes = randomBytes(4).toString('hex'); // 8 hex chars
    const secret = randomBytes(24).toString('base64url');
    const keyPrefix = `svc_${prefixBytes}`;
    const apiKey = `${keyPrefix}_${secret}`;
    const keyHash = this.tokens.hashToken(apiKey);
    const row = await this.repo.create({
      name,
      keyPrefix,
      keyHash,
      role: 'agent',
      createdBy: createdBy ?? undefined,
    });
    return { id: row.id, name: row.name, keyPrefix, apiKey };
  }

  async exchangeForToken(
    apiKey: string,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    const cred = await this.repo.findByKeyHash(this.tokens.hashToken(apiKey));
    if (
      !cred ||
      cred.revokedAt ||
      (cred.expiresAt && cred.expiresAt.getTime() <= Date.now())
    ) {
      throw this.errors.create(ErrorCode.AUTH_SERVICE_CREDENTIAL_INVALID);
    }
    await this.repo.touch(cred.id);
    const ttl = this.tokens.agentTtl();
    const accessToken = this.tokens.signAccessToken(
      { sub: cred.id, role: cred.role, kind: 'service' },
      ttl,
    );
    return { accessToken, expiresIn: ttl };
  }

  async list(): Promise<PublicCredential[]> {
    const rows = await this.repo.list();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      keyPrefix: r.keyPrefix,
      role: r.role,
      createdAt: r.createdAt,
      lastUsedAt: r.lastUsedAt ?? null,
      revokedAt: r.revokedAt ?? null,
    }));
  }

  async revoke(id: string): Promise<void> {
    // Through the revocation service so the cached verdict is dropped too —
    // otherwise the credential is revoked in Postgres while its outstanding
    // access token keeps working.
    await this.revocation.revokeCredential(id);
  }
}
