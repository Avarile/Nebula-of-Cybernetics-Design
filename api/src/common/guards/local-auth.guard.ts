import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Guards POST /auth/login with the passport 'local' strategy. */
@Injectable()
export class LocalAuthGuard extends AuthGuard('local') {}
