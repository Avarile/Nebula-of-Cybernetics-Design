import type { ApiClient } from './client';
import type { Ctx } from './context';
import type { Principal } from './types';

/**
 * Signing in, provisioning the non-admin account, and staying signed in.
 *
 * Shared by the assertion suite and the data generator rather than duplicated:
 * both need exactly the same two principals, and a second copy of the token
 * bookkeeping would be a second place for the refresh-rotation rule below to
 * be got wrong.
 */

export function decodeClaims(token: string): Record<string, any> | undefined {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
  } catch {
    return undefined;
  }
}

export function fatal(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(2);
}

/**
 * Trades the principal's refresh token for a fresh access token.
 *
 * A comprehensive run takes longer than the 15-minute access TTL, so without
 * this the tail of the run 401s wholesale. Refresh rather than re-login:
 * `/auth/login` carries a 5-per-minute budget a renewal has no business
 * competing for. The rotated refresh token is stored back, because replaying a
 * spent one is treated as theft and revokes the entire family.
 */
export function renewer(
  baseUrl: string,
  principal: Principal,
): () => Promise<{ accessToken: string; refreshToken?: string } | null> {
  return async () => {
    const res = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: principal.refreshToken }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      accessToken?: string;
      refreshToken?: string;
    };
    return body.accessToken
      ? { accessToken: body.accessToken, refreshToken: body.refreshToken }
      : null;
  };
}

export async function requireServer(baseUrl: string): Promise<void> {
  try {
    const res = await fetch(`${baseUrl}/health/live`);
    if (!res.ok) fatal(`${baseUrl}/health/live returned ${res.status}.`);
  } catch {
    fatal(
      `No server is answering at ${baseUrl}. Start it with \`pnpm start\`.`,
    );
  }
}

export interface BootstrapOptions {
  adminEmail: string;
  adminPassword: string;
  /** Local-part prefix for the provisioned account, so runs stay identifiable. */
  mockPrefix: string;
  /** Announce the two identities on stdout. */
  announce?: boolean;
}

/**
 * Signs in as the seeded admin, then provisions the non-admin account.
 *
 * The explicit `user` role grant is not incidental: `POST /users` writes
 * `users.role` but never inserts a `user_roles` row, and the permission
 * resolver reads user grants exclusively from `user_roles`. Without it a
 * freshly provisioned account resolves to zero permissions.
 */
export async function bootstrapPrincipals(
  ctx: Ctx,
  opts: BootstrapOptions,
): Promise<void> {
  const { client, stamp } = ctx;
  const { adminEmail, adminPassword } = opts;

  const adminLogin = await client.call({
    name: 'default admin signs in',
    method: 'POST',
    path: '/auth/login',
    actor: 'anon',
    body: { email: adminEmail, password: adminPassword },
    expect: 200,
  });
  if (!adminLogin.ok) {
    fatal(
      `Could not sign in as ${adminEmail}. Has the seeder run against this database?`,
    );
  }

  const adminClaims = decodeClaims(adminLogin.body.accessToken);
  ctx.facts.adminUserId = adminClaims?.sub;
  const adminPrincipal: Principal = {
    email: adminEmail,
    password: adminPassword,
    userId: adminClaims?.sub ?? '',
    accessToken: adminLogin.body.accessToken,
    refreshToken: adminLogin.body.refreshToken,
    role: 'admin',
  };
  adminPrincipal.renew = renewer(ctx.baseUrl, adminPrincipal);
  client.setPrincipal('admin', adminPrincipal);

  if (adminClaims?.role !== 'admin') {
    fatal(
      `SEED_ADMIN_EMAIL resolves to role "${adminClaims?.role}", not admin.`,
    );
  }

  const mockEmail = `${opts.mockPrefix}.${stamp}@cybernetics.test`;
  const mockPassword = 'Mock-User-Password-1!';

  const created = await client.call({
    name: 'admin provisions the mock user',
    method: 'POST',
    path: '/users',
    actor: 'admin',
    body: {
      email: mockEmail,
      password: mockPassword,
      role: 'user',
      displayName: 'API Suite Mock User',
    },
    expect: 201,
  });
  if (!created.ok) fatal('Could not provision the mock user.');

  await client.call({
    name: 'admin grants the mock user its baseline role',
    method: 'POST',
    path: '/authorization/users/{userId}/roles',
    params: { userId: created.body.id },
    actor: 'admin',
    body: { roleKey: 'user' },
    expect: 204,
  });

  const mockLogin = await client.call({
    name: 'the mock user signs in',
    method: 'POST',
    path: '/auth/login',
    actor: 'anon',
    body: { email: mockEmail, password: mockPassword },
    expect: 200,
  });
  if (!mockLogin.ok) fatal('The mock user could not sign in.');

  ctx.ids.mockUserId = created.body.id;
  const mockPrincipal: Principal = {
    email: mockEmail,
    password: mockPassword,
    userId: created.body.id,
    accessToken: mockLogin.body.accessToken,
    refreshToken: mockLogin.body.refreshToken,
    role: 'user',
  };
  mockPrincipal.renew = renewer(ctx.baseUrl, mockPrincipal);
  client.setPrincipal('user', mockPrincipal);

  if (opts.announce !== false) {
    console.log(`  admin       ${adminEmail}`);
    console.log(`  mock user   ${mockEmail}  (${created.body.id})\n`);
  }
}

export type { ApiClient };
