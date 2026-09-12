import { Injectable } from '@nestjs/common';
import { roleOf, type Principal } from '../../common/principal';
import type { UserRow } from '../../infrastructure/database/schema/identity.schema';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import { UserRepository } from '../users/user.repository';
import type { TokenPair, UserProfile } from './auth.types';
import { PasswordService } from './password.service';
import { SessionRepository } from './session.repository';
import { SessionRevocationService } from './session-revocation.service';
import { TokenService } from './token.service';

export interface RequestContext {
  userAgent?: string;
  ip?: string;
}

/** A sanitized view of an active session (never exposes the token hash). */
export interface SessionSummary {
  id: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date;
  userAgent: string | null;
  ip: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly revocation: SessionRevocationService,
    private readonly tokens: TokenService,
    private readonly passwords: PasswordService,
    private readonly errors: ExceptionService,
  ) {}

  /**
   * Full identity for GET /auth/me: the principal plus the user's email and
   * display name loaded from the DB. Non-user callers (service credentials)
   * have no users row, so they get the bare principal back.
   */
  async getProfile(principal: Principal): Promise<UserProfile> {
    // The subject id as the caller knows it — a `users.id` for a human, a
    // `service_credentials.id` for a machine. Deliberately NOT `userIdOrNull`,
    // which exists to keep credential ids out of `users` foreign keys; this is
    // a display value, not a key.
    const subjectId =
      principal.kind === 'user'
        ? principal.userId
        : principal.kind === 'service'
          ? principal.credentialId
          : null;
    const base: UserProfile = {
      id: subjectId,
      kind: principal.kind,
      role: roleOf(principal),
    };
    if (principal.kind !== 'user') return base;
    const user = await this.users.findActiveById(principal.userId);
    if (!user) return base;
    return {
      ...base,
      role: user.role,
      email: user.email,
      displayName: user.displayName,
    };
  }

  /** Used by LocalStrategy. Uniform 401 — never reveals which factor failed. */
  async validateUser(email: string, password: string): Promise<UserRow> {
    if (typeof email !== 'string' || typeof password !== 'string') {
      throw this.errors.create(ErrorCode.AUTH_INVALID_CREDENTIALS);
    }
    const user = await this.users.findByEmail(email.toLowerCase());
    if (!user) {
      // Spend the same argon2 work as a real verification before failing, so
      // response time does not reveal whether the account exists.
      await this.passwords.verifyDecoy(password);
      throw this.errors.create(ErrorCode.AUTH_INVALID_CREDENTIALS);
    }
    const ok = await this.passwords.verify(user.passwordHash, password);
    if (!ok) throw this.errors.create(ErrorCode.AUTH_INVALID_CREDENTIALS);
    return user;
  }

  async login(user: UserRow, ctx: RequestContext): Promise<TokenPair> {
    const familyId = this.tokens.newFamilyId();
    const pair = await this.issuePair(user, familyId, ctx);
    await this.users.stampLogin(user.id);
    return pair;
  }

  async refresh(refreshToken: string, ctx: RequestContext): Promise<TokenPair> {
    const tokenHash = this.tokens.hashToken(refreshToken);
    const session = await this.sessions.findByTokenHash(tokenHash);
    if (!session) throw this.errors.create(ErrorCode.AUTH_TOKEN_INVALID);

    if (session.revokedAt) {
      // Replay of a rotated/revoked token → assume theft; revoke the family.
      await this.revocation.revokeFamily(session.familyId);
      throw this.errors.create(ErrorCode.AUTH_TOKEN_REUSE);
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw this.errors.create(ErrorCode.AUTH_TOKEN_EXPIRED);
    }

    const user = await this.users.findActiveById(session.userId);
    if (!user) throw this.errors.create(ErrorCode.AUTH_TOKEN_INVALID);

    // Compare-and-set, not read-then-write. Two concurrent refreshes with the
    // same token both used to pass the `revokedAt` check above and both minted a
    // pair, splitting the family into two live lineages — which is precisely the
    // state the reuse detection exists to catch.
    if (!(await this.revocation.claimForRotation(session.id))) {
      throw this.errors.create(ErrorCode.AUTH_TOKEN_INVALID);
    }
    return this.issuePair(user, session.familyId, ctx);
  }

  async logout(refreshToken: string): Promise<void> {
    const session = await this.sessions.findByTokenHash(
      this.tokens.hashToken(refreshToken),
    );
    if (session && !session.revokedAt) {
      await this.revocation.revokeSession(session.id);
    }
  }

  async logoutAll(userId: string): Promise<void> {
    await this.revocation.revokeAllForUser(userId);
  }

  async changePassword(
    userId: string,
    current: string,
    next: string,
  ): Promise<void> {
    const user = await this.users.findActiveById(userId);
    if (!user || !(await this.passwords.verify(user.passwordHash, current))) {
      throw this.errors.create(ErrorCode.AUTH_INVALID_CREDENTIALS, {
        message: 'Current password is incorrect',
      });
    }
    await this.users.update(userId, {
      passwordHash: await this.passwords.hash(next),
    });
    await this.revocation.revokeAllForUser(userId); // force re-login everywhere
  }

  async listSessions(userId: string): Promise<SessionSummary[]> {
    const rows = await this.sessions.listActiveForUser(userId);
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      lastUsedAt: r.lastUsedAt ?? null,
      expiresAt: r.expiresAt,
      userAgent: r.userAgent ?? null,
      ip: r.ip ?? null,
    }));
  }

  private async issuePair(
    user: UserRow,
    familyId: string,
    ctx: RequestContext,
  ): Promise<TokenPair> {
    // Session first, token second: the access token carries the session id, so
    // the row has to exist before there is anything to sign. (The reverse order
    // is why the two were never linked.)
    const refresh = this.tokens.generateRefreshToken();
    const session = await this.sessions.create({
      userId: user.id,
      tokenHash: refresh.tokenHash,
      familyId,
      expiresAt: this.tokens.refreshExpiry(),
      userAgent: ctx.userAgent,
      ip: ctx.ip,
    });
    const accessToken = this.tokens.signAccessToken({
      sub: user.id,
      role: user.role,
      email: user.email,
      kind: 'user',
      sid: session.id,
    });
    return {
      accessToken,
      refreshToken: refresh.token,
      expiresIn: this.tokens.accessTtl(),
    };
  }
}
