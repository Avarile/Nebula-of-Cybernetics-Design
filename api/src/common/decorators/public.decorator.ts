import { SetMetadata } from '@nestjs/common';

/** Metadata key marking a route as not requiring authentication. */
export const IS_PUBLIC_KEY = 'isPublic';

/** Opt a route (or controller) out of the global JwtAuthGuard. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
