import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Principal } from '../../../common/principal';
import type { AuthConfig } from '../../../config/configurations/auth.config';
import { AppException, ErrorCode } from '../../../infrastructure/exceptions';
import type { AccessTokenClaims } from '../auth.types';
import { TokenValidityService } from '../token-validity.service';

/** Validates the Bearer access token on protected requests. */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly validity: TokenValidityService,
  ) {
    const cfg = config.getOrThrow<AuthConfig>('auth');
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: cfg.jwtAccessSecret,
      issuer: cfg.issuer,
      // Verified, not merely signed: a token minted by another service that
      // happens to share the secret is rejected here rather than accepted.
      audience: cfg.audience,
      algorithms: ['HS256'],
    });
  }

  /**
   * Build the acting principal from the verified claims.
   *
   * `kind` has always been signed into the token; it used to be discarded here,
   * which is how a service credential's `service_credentials.id` ended up in
   * `Principal.id` alongside real `users.id`s and then flowed into columns that
   * reference `users`. Reading it is what keeps the two apart.
   *
   * Fails closed: a token whose `kind`/`role` pair is not one this app issues is
   * rejected rather than coerced into some nearby principal.
   *
   * The signature and expiry checks above prove the token was issued by us and
   * has not aged out. They cannot prove the identity behind it still exists or
   * is still permitted — that is current state, not a signed claim — so
   * `TokenValidityService` is consulted before any principal is handed back.
   */
  async validate(payload: AccessTokenClaims): Promise<Principal> {
    const principal = this.toPrincipal(payload);
    await this.validity.assertLive(payload);
    return principal;
  }

  private toPrincipal(payload: AccessTokenClaims): Principal {
    if (payload.kind === 'user') {
      if (payload.role !== 'user' && payload.role !== 'admin') {
        throw new AppException(ErrorCode.AUTH_TOKEN_INVALID, {
          message: 'Token claims a user identity with a non-user role',
        });
      }
      return { kind: 'user', userId: payload.sub, role: payload.role };
    }
    if (payload.kind === 'service') {
      return { kind: 'service', credentialId: payload.sub, role: 'agent' };
    }
    throw new AppException(ErrorCode.AUTH_TOKEN_INVALID, {
      message: 'Unrecognised token kind',
    });
  }
}
