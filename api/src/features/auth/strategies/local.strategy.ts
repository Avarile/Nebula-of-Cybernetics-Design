import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import type { UserRow } from '../../../infrastructure/database/schema/identity.schema';
import { AuthService } from '../auth.service';

/** Authenticates POST /auth/login by email + password. */
@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly auth: AuthService) {
    super({ usernameField: 'email' });
  }

  validate(email: string, password: string): Promise<UserRow> {
    return this.auth.validateUser(email, password);
  }
}
