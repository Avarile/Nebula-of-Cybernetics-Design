import { Module } from '@nestjs/common';
import { PasswordService } from '../auth/password.service';
import { TokenRevocationModule } from '../auth/token-revocation.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { SystemSettingsModule } from '../system/system-settings.module';
import {
  ProfileController,
  UserProfileAdminController,
} from './profile.controller';
import { ProfileRepository } from './profile.repository';
import { ProfileService } from './profile.service';
import { UserRepository } from './user.repository';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Users feature. Owns admin user provisioning and exports the repository,
 * service, and PasswordService so AuthModule can reuse them (Auth → Users;
 * Users has no dependency on Auth, so no circular import).
 */
@Module({
  imports: [TokenRevocationModule, AuthorizationModule, SystemSettingsModule],
  controllers: [UsersController, ProfileController, UserProfileAdminController],
  providers: [
    UserRepository,
    UsersService,
    PasswordService,
    ProfileRepository,
    ProfileService,
  ],
  exports: [UserRepository, UsersService, PasswordService, ProfileService],
})
export class UsersModule {}
