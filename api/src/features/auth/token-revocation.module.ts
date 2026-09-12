import { Module } from '@nestjs/common';
import { SessionCacheModule } from '../../infrastructure/cache/session/session-cache.module';
import { ServiceCredentialRepository } from './service-credential.repository';
import { SessionRepository } from './session.repository';
import { SessionRevocationService } from './session-revocation.service';
import { TokenValidityService } from './token-validity.service';

/**
 * Token validity and revocation, on their own.
 *
 * Split out of `AuthModule` so `UsersModule` can revoke sessions on a role
 * change or a soft-delete without importing `AuthModule` — the dependency runs
 * Auth → Users, and reversing it would be a cycle.
 *
 * Nothing in here depends on `UsersModule`: the "is the owning user still live?"
 * check is a join inside `SessionRepository.findLiveById` rather than a second
 * repository, which is what keeps this module importable from both directions.
 * Same shape as `MastraRepositoriesModule` and `SystemAuditModule`.
 */
@Module({
  imports: [SessionCacheModule],
  providers: [
    SessionRepository,
    ServiceCredentialRepository,
    TokenValidityService,
    SessionRevocationService,
  ],
  exports: [
    SessionRepository,
    ServiceCredentialRepository,
    TokenValidityService,
    SessionRevocationService,
  ],
})
export class TokenRevocationModule {}
