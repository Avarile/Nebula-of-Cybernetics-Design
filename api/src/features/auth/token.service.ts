import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AuthConfig } from '../../config/configurations/auth.config';
import type { AccessTokenClaims, GeneratedRefreshToken } from './auth.types';

/** Access-token signing (HS256) + opaque refresh-token crypto. */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private get cfg(): AuthConfig {
    return this.config.getOrThrow<AuthConfig>('auth');
  }

  signAccessToken(claims: AccessTokenClaims, ttlSeconds?: number): string {
    const cfg = this.cfg;
    return this.jwt.sign(claims, {
      secret: cfg.jwtAccessSecret,
      issuer: cfg.issuer,
      audience: cfg.audience,
      expiresIn: ttlSeconds ?? cfg.accessTtl,
    });
  }

  accessTtl(): number {
    return this.cfg.accessTtl;
  }

  agentTtl(): number {
    return this.cfg.agentTokenTtl;
  }

  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  generateRefreshToken(): GeneratedRefreshToken {
    const token = randomBytes(32).toString('base64url');
    return { token, tokenHash: this.hashToken(token) };
  }

  newFamilyId(): string {
    return randomUUID();
  }

  refreshExpiry(): Date {
    return new Date(Date.now() + this.cfg.refreshTtl * 1000);
  }
}
